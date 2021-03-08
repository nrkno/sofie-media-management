import * as _ from 'underscore'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as fs from 'fs-extra'
import { noTryAsync, noTry } from 'no-try'
import { LoggerInstance } from 'winston'

import { PeripheralDeviceAPI as P } from '@sofie-automation/server-core-integration'

import {
	extendMandadory,
	randomId,
	getCurrentTime,
	getFlowHash,
	throttleOnKey,
	atomic,
	Omit,
	updateDB,
	wait
} from '../lib/lib'
import { WorkFlow, WorkFlowDB, WorkStep, WorkStepStatus, DeviceSettings, MediaObject } from '../api'
import { WorkStepDB, workStepToPlain, plainToWorkStep, GeneralWorkStepDB } from './workStep'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from '../workflowGenerators/baseWorkFlowGenerator'
import { StorageObject } from '../storageHandlers/storageHandler'
import { Worker, WorkResult } from './worker'
import { TrackedMediaItems } from '../mediaItemTracker'
import { CoreHandler } from '../coreHandler'
import { MonitorQuantel } from '../monitors/quantel'

const CRON_JOB_INTERVAL = 10 * 60 * 60 * 1000 // 10 hours (ms)
const WARNING_WF_QUEUE_LENGTH = 10 // 10 items
const WARNING_TASK_WORKING_TIME = 15 * 60 * 1000 // 15 minutes

// TODO: Move this into server-core-integration
enum MMPDMethods {
	'getMediaWorkFlowRevisions' = 'peripheralDevice.mediaManager.getMediaWorkFlowRevisions',
	'updateMediaWorkFlow' = 'peripheralDevice.mediaManager.updateMediaWorkFlow',
	'getMediaWorkFlowStepRevisions' = 'peripheralDevice.mediaManager.getMediaWorkFlowStepRevisions',
	'updateMediaWorkFlowStep' = 'peripheralDevice.mediaManager.updateMediaWorkFlowStep'
}

const PROCESS_NAME = 'Dispatcher'

/**
 * The dispatcher connects the storages to the workflow generators.
 * Then it dispathes the work to the workers.
 */
export class Dispatcher {
	private workers: Worker[] = []

	private workFlows: PouchDB.Database<WorkFlowDB>
	private workSteps: PouchDB.Database<WorkStepDB>

	private cronJobInterval: NodeJS.Timer | undefined = undefined
	private watchdogInterval: NodeJS.Timer | undefined = undefined

	private cronJobTime: number
	private watchdogTime: number = 5 * 60 * 1000
	private watchdogRunning: boolean = false

	private warningWFQueueLength: number
	private warningTaskWorkingTime: number

	private quantelMonitor: MonitorQuantel | undefined

	constructor(
		private mediaDB: PouchDB.Database<MediaObject>,
		private generators: BaseWorkFlowGenerator[],
		private availableStorage: StorageObject[],
		private tmi: TrackedMediaItems,
		private config: DeviceSettings,
		private workersCount: number,
		private workFlowLingerTime: number,
		private coreHandler: CoreHandler,
		private logger: LoggerInstance
	) {
		this.coreHandler.restartWorkflow = workflowId => this.actionRestartWorkflow(workflowId)
		this.coreHandler.abortWorkflow = workflowId => this.actionAbortWorkflow(workflowId)
		this.coreHandler.prioritizeWorkflow = workflowId => this.prioritizeWorkflow(workflowId)
		this.coreHandler.restartAllWorkflows = () => this.actionRestartAllWorkflows()
		this.coreHandler.abortAllWorkflows = () => this.actionAbortAllWorkflows()

		this.cronJobTime = config.cronJobTime || CRON_JOB_INTERVAL
		this.warningTaskWorkingTime = config.warningTaskWorkingTime || WARNING_TASK_WORKING_TIME
		this.warningWFQueueLength = config.warningWFQueueLength || WARNING_WF_QUEUE_LENGTH
	}

	private async initDB(): Promise<void> {
		PouchDB.plugin(PouchDBFind)
		await fs.ensureDir('./db') // TODO this should be configurable?
		const PrefixedPouchDB = PouchDB.defaults({
			prefix: './db/'
		} as PouchDB.Configuration.DatabaseConfiguration)

		this.workFlows = new PrefixedPouchDB('workFlows')
		this.workSteps = new PrefixedPouchDB('workSteps')

		await Promise.all([this.initWorkflowsDB(), this.initWorkStepsDB()])
	}

	private async initWorkflowsDB(): Promise<void> {
		const { error } = await noTryAsync(async () => {
			await this.workFlows.createIndex({
				index: {
					fields: ['priority']
				}
			})
			await this.workFlows.createIndex({
				index: {
					fields: ['finished']
				}
			})
			await this.workFlows.createIndex({
				index: {
					fields: ['finished', 'created']
				}
			})
			this.logger.debug(`Dispatcher: DB "workFlows" index "priority" succesfully created.`)
		})
		if (error) {
			throw new Error(`Dispatcher: could not initialize "workFlows" database: ${error.message}`)
		}
	}

	private async initWorkStepsDB(): Promise<void> {
		const { error } = await noTryAsync(async () => {
			await this.workSteps.createIndex({
				index: {
					fields: ['workFlowId']
				}
			})
			await this.workSteps.createIndex({
				index: {
					fields: ['status']
				}
			})
			this.logger.debug(`Dispatcher: DB "workSteps" index "status" & "workFlowId" succesfully created.`)
		})
		if (error) {
			throw new Error(`Dispatcher: could not initialize "workSteps" database: ${error.message}`)
		}
	}

	async init(): Promise<void> {
		await this.initDB()
		for (let i = 0; i < this.workersCount; i++) {
			this.workers.push(new Worker(this.workSteps, this.mediaDB, this.tmi, this.config, this.logger, i))
		}
		await this.cleanupOldWorkflows()
		await noTryAsync(
			() => this.initialWorkFlowSync(),
			e => {
				this.logger.error(`Dispatcher: failed to synchronize workFlows with core`, e)
				process.exit(1)
			}
		)
		await noTryAsync(
			() => this.initialWorkStepsSync(),
			e => {
				this.logger.error(`Dispatcher: failed to synchronize workSteps with core`, e)
				process.exit(1)
			}
		)
		// Maintain one-to-many relationship for the WorkFlows and WorkSteps
		// Update WorkFlows and WorkSteps in Core
		let workflowChanges = this.workFlows.changes({
			since: 'now',
			live: true,
			include_docs: true
		})
		workflowChanges.on('change', async change => {
			if (change.deleted) {
				let { result } = await noTryAsync(
					() =>
						this.workSteps.find({
							selector: {
								workFlowId: change.id
							}
						}),
					(error: Error) => {
						this.logger.error(`Dispatcher: could not find workflow with id "${change.id}" on change`, error)
					}
				)
				let { error } = await noTryAsync(() => Promise.all(result.docs.map(i => this.workSteps.remove(i))))
				if (error) {
					this.logger.error(`Dispatcher: could not remove orphaned WorkSteps`, error)
				} else {
					this.logger.debug(
						`Dispatcher: ` + `removed ${result.docs.length} orphaned WorkSteps for WorkFlow "${change.id}"`
					)
				}
				noTryAsync(
					() => this.pushWorkFlowToCore(change.id, null),
					err =>
						this.logger.debug(
							`Dispatcher: failed to push WorkFlow delete change with ID "${change.id}" to core`,
							err
						)
				)
			} else if (change.doc) {
				let changeDoc = change.doc
				noTryAsync(
					() => this.pushWorkFlowToCore(change.id, changeDoc),
					err =>
						this.logger.debug(
							`Dispatcher: failed to push WorkFlow update change with ID "${change.id}" to core`,
							err
						)
				)
			}
		})
		workflowChanges.on('error', err => {
			this.logger.error(`Dispatcher: an error happened in the WorkFlow changes stream`, err)
		})

		let workstepChanges = this.workSteps.changes({
			since: 'now',
			live: true,
			include_docs: true
		})
		workstepChanges.on('change', change => {
			if (change.deleted) {
				noTryAsync(
					() => this.pushWorkStepToCore(change.id, null),
					err =>
						this.logger.debug(
							`Dispatcher: failed to push WorkStep delete change with ID "${change.id}" to core`,
							err
						)
				)
			} else if (change.doc) {
				let changeDoc = change.doc
				noTryAsync(
					() => this.pushWorkStepToCore(change.id, changeDoc),
					err =>
						this.logger.debug(
							`Dispatcher: failed to push WorkStep delete change with ID "${change.id}" to core`,
							err
						)
				)
			}
		})
		workstepChanges.on('error', err => {
			this.logger.error(`Dispatcher: an error happened in the WorkStep changes stream`, err)
		})

		// clean up old work-flows every now and then:
		this.cronJobInterval = setInterval(() => {
			noTryAsync(
				() => this.cleanupOldWorkflows(),
				e => this.logger.error(`Dispatcher: unhandled error in cleanupOldWorkflows`, e)
			)
		}, this.cronJobTime)
		this.watchdogInterval = setInterval(() => {
			this.watchdog()
		}, this.watchdogTime)

		this.coreHandler.setProcessState('MediaScanner', [], P.StatusCode.GOOD),
			await Promise.all(this.generators.map(gen => gen.init()))
		this.logger.debug(`Dispatcher: initialized`)

		this.generators.forEach(gen => {
			gen.on(WorkFlowGeneratorEventType.NEW_WORKFLOW, this.onNewWorkFlow)
		})
		await this.cancelLeftoverWorkSteps()
	}

	// FIXME nothing calls this
	async destroy(): Promise<void> {
		const { error: genError } = await noTryAsync(() => Promise.all(this.generators.map(gen => gen.destroy())))
		if (genError) {
			this.logger.warn(`Dispatcher: failed to dispose of one or more generators`, genError)
		} else {
			this.logger.debug(`Dispatcher: workFlow generators destroyed`)
		}

		if (this.cronJobInterval) {
			clearInterval(this.cronJobInterval)
		}
		if (this.watchdogInterval) {
			clearInterval(this.watchdogInterval)
		}
		this.logger.debug(`Dispatcher: WorkFlow clean up task destroyed`)

		const { error: handlerError } = await noTryAsync(() =>
			Promise.all(this.availableStorage.map(st => st.handler.destroy()))
		)
		if (handlerError) {
			this.logger.warn(`Dispather: failed to dispose of one or more storage handlers`, handlerError)
		}
		this.logger.debug('Dispatcher: storage handlers destroyed')
		this.logger.debug(`Dispatcher: destroyed`)
	}

	private async watchdog(): Promise<void> {
		if (this.watchdogRunning) return
		this.watchdogRunning = true

		let { result: workflows } = await noTryAsync(
			() =>
				this.workFlows.allDocs({
					include_docs: true
				}),
			err => {
				this.logger.error(`Dispatch: watchdog: could not list all WorkFlows, restarting`, err)
				this.watchdogRunning = false
				this.coreHandler.killProcess(1)
				return
			}
		)

		noTry(
			() => {
				const unfinishedWorkFlows = workflows.rows.filter(i => i.doc && i.doc.finished === false)
				const oldWorkFlows = unfinishedWorkFlows.filter(
					i => i.doc && i.doc.created < getCurrentTime() - 3 * 60 * 60 * 1000
				)
				const recentlyFinished = workflows.rows.filter(
					i => i.doc && i.doc.finished && i.doc.modified && i.doc.modified > getCurrentTime() - 15 * 60 * 1000
				)
				const oldUnfinishedWorkFlows = unfinishedWorkFlows.filter(
					i => i.doc && i.doc.created <= getCurrentTime() - 15 * 60 * 1000
				)
				if (oldUnfinishedWorkFlows.length > 0 && recentlyFinished.length === 0) {
					this.coreHandler.setProcessState(
						PROCESS_NAME,
						[`Media Manager seems to be stuck. Please contact support.`],
						P.StatusCode.BAD
					)
					return
				}
				if (oldWorkFlows.length > 0) {
					this.coreHandler.setProcessState(
						PROCESS_NAME,
						[
							`Media Manager has one or more workflows that are more than 3 hours old. Please contact support.`
						],
						P.StatusCode.BAD
					)
					this.watchdogRunning = false
					return
				}
				if (unfinishedWorkFlows.length > this.warningWFQueueLength) {
					this.coreHandler.setProcessState(
						PROCESS_NAME,
						[
							`The Media Manager's queue is now ${unfinishedWorkFlows.length} items long. Please contact support.`
						],
						P.StatusCode.WARNING_MAJOR
					)
					this.watchdogRunning = false
					return
				}
				if (
					_.compact(
						this.workers.map(
							i => i.lastBeginStep && i.lastBeginStep < getCurrentTime() - this.warningTaskWorkingTime
						)
					).length > 0
				) {
					this.coreHandler.setProcessState(
						PROCESS_NAME,
						[
							`Some workers have been working for more than ${Math.floor(
								this.warningTaskWorkingTime / (60 * 1000)
							)} minutes`
						],
						P.StatusCode.BAD
					)
					this.watchdogRunning = false
					return
				}
				// no problems found, set status to GOOD
				this.coreHandler.setProcessState(PROCESS_NAME, [], P.StatusCode.GOOD)
			},
			err => {
				this.logger.error(`Dispatcher: watchdog: error`, err)
			}
		)
		this.watchdogRunning = false
	}

	private async actionRestartAllWorkflows() {
		const wfs = await this.workFlows.find({
			selector: {
				finished: true
			}
		})
		await Promise.all(wfs.docs.map(i => this.actionRestartWorkflow(i._id)))
	}

	private async actionAbortAllWorkflows() {
		const wfs = await this.workFlows.find({
			selector: {
				finished: false
			}
		})
		await Promise.all(wfs.docs.map(i => this.actionAbortWorkflow(i._id)))
	}

	private async actionRestartWorkflow(workflowId: string) {
		const { result: wf, error: getError } = await noTryAsync(() => this.workFlows.get<WorkFlowDB>(workflowId))

		if (getError || !wf) throw Error(`Dispatcher: workflow "${workflowId}" not found`)

		// Step 1: Abort the workflow
		await this.actionAbortWorkflow(wf._id)

		// Step 2: Reset the workflow
		const steps = await this.workSteps.find({
			selector: {
				workFlowId: workflowId
			}
		})
		// Reset the workflow steps
		await Promise.all(
			steps.docs.map((step: WorkStepDB) =>
				updateDB(this.workSteps, step._id, step => {
					step.status = WorkStepStatus.IDLE
					step.messages = [`Restarted at ${new Date().toTimeString()}`]
					step.progress = 0
					step.expectedLeft = undefined
					step.modified = getCurrentTime()
					return step
				})
			)
		)
		await updateDB(this.workFlows, wf._id, wf => {
			wf.finished = false
			wf.success = false
			wf.modified = getCurrentTime()
			// wf.priority = 999
			return wf
		})

		this.dispatchWork()
	}

	private async prioritizeWorkflow(workflowId: string) {
		const { result: wf, error: getError } = await noTryAsync(() => this.workFlows.get<WorkFlowDB>(workflowId))

		if (getError || !wf) throw Error(`Workflow "${workflowId}" not found`)

		const prioritized = wf.priority > 1 ? true : false
		const result = await this.workSteps.find({
			selector: {
				workFlowId: workflowId
			}
		})
		await Promise.all(
			result.docs.map(item =>
				updateDB(this.workSteps, item._id, item => {
					item.priority = prioritized ? item.priority / 10 : item.priority * 10
					item.modified = getCurrentTime()
					item.messages = _.union(item.messages || [], [
						`Dispatcher: priority changed to ${item.priority} at ${new Date(getCurrentTime())}`
					])
					return item
				})
			)
		)

		await updateDB(this.workFlows, wf._id, wf => {
			wf.modified = getCurrentTime()
			wf.priority = prioritized ? wf.priority / 2 : wf.priority * 2
			return wf
		})
	}

	private async actionAbortWorkflow(workflowId: string) {
		const { result: wf, error: getError } = await noTryAsync(() => this.workFlows.get<WorkFlowDB>(workflowId))

		if (getError || !wf) throw Error(`Dispatcher: workflow "${workflowId}" not found`)

		// Step 1: Block all Idle steps
		await this.blockStepsInWorkFlow(wf._id, 'Aborted')

		// Step 2: Try to abort the workers and wait for them to finish
		// Reset workers:
		const ps: Array<Promise<any>> = []
		this.workers.forEach((worker: Worker) => {
			if (worker.busy && worker.step) {
				if (worker.step.workFlowId === workflowId) {
					worker.tryToAbort()

					ps.push(worker.waitUntilFinished())
				}
			}
		})
		// Wait for all relevant workers to finish:
		await Promise.all(ps)

		await updateDB(this.workFlows, wf._id, wf => {
			wf.finished = true
			wf.success = false
			wf.modified = getCurrentTime()
			return wf
		})
	}

	private async cleanupOldWorkflows(): Promise<void> {
		const { result, error: findError } = await noTryAsync(() =>
			this.workFlows.find({
				selector: {
					created: { $lt: getCurrentTime() - this.workFlowLingerTime },
					finished: true
				}
			})
		)
		if (findError) {
			this.logger.error(`Dispatcher: could not get stale WorkFlows`, findError)
		} else {
			const { error: removeError } = await noTryAsync(() =>
				Promise.all(
					result.docs.map(
						async (i): Promise<void> => {
							await noTryAsync(
								() => this.workFlows.remove(i),
								e => this.logger.error(`Dispatcher: failed to remove stale workflow "${i._id}"`, e)
							)
						}
					)
				)
			)
			if (removeError) {
				this.logger.error(`Dispatcher: failed to remove stale workflows`, removeError)
			} else {
				if (result.docs.length) {
					this.logger.debug(`Dispatcher: removed ${result.docs.length} stale WorkFlows`)
				}
			}
		}

		const {
			result: [workFlowResponse, workStepsResponse],
			error: orphanError
		} = await noTryAsync(() =>
			Promise.all([
				this.workFlows.allDocs({
					include_docs: true,
					attachments: false
				}),
				this.workSteps.allDocs({
					include_docs: true,
					attachments: false
				})
			])
		)

		if (orphanError) {
			this.logger.warn(`Dispatcher: error on parallel all documents query`, orphanError)
			return
		}

		const workFlows = workFlowResponse.rows
		const workSteps = workStepsResponse.rows

		const map: { [id: string]: true } = {}
		workFlows.forEach(workFlow => {
			map[workFlow.id] = true
		})

		const ps: Array<Promise<any>> = []
		workSteps.forEach(step => {
			if (step.doc) {
				if (!map[step.doc.workFlowId]) {
					ps.push(this.workSteps.remove(step.doc))
				}
			}
		})
		if (ps.length) this.logger.debug(`Dispatcher: removed ${ps.length} orphaned WorkSteps`)

		await noTryAsync(
			() => Promise.all(ps),
			error => this.logger.error(`Dispatcher: error when removing WorkSteps`, error)
		)
	}

	/**
	 *  Called whenever there's a new workflow from a WorkflowGenerator
	 */
	private onNewWorkFlow = atomic(async (finished: () => void, wf: WorkFlow, generator: BaseWorkFlowGenerator) => {
		// TODO: This should also handle extra workflows using a hash of the basic WorkFlow object to check if there is a WORKING or IDLE workflow that is the same
		const hash = getFlowHash(wf)
		const wfDb: WorkFlowDB = Object.assign({}, wf, { hash, _rev: '', steps: undefined })
		wfDb.modified = getCurrentTime()

		// console.log(`Current hash: ${hash}`)

		this.logger.debug(
			`Dispatcher: caught new workFlow: "${wf._id}" from ${generator.constructor.name}. Hash ${hash}.`
		)
		// persist workflow to db:
		const { result: docs, error: docsError } = await noTryAsync(() =>
			this.workFlows.allDocs({
				include_docs: true
			})
		)
		if (docsError) {
			this.logger.error(`Dispatcher: error when requesting all WorkFlows`, docsError)
			throw docsError // TODO too extreme?
		}

		let stepCache: PouchDB.Core.AllDocsResponse<WorkStepDB> | undefined = undefined
		for (let i = 0; i < docs.rows.length; i++) {
			const item: WorkFlowDB | undefined = docs.rows[i].doc
			if (item === undefined) continue
			if (item.hash === hash) {
				if (!item.finished) {
					this.logger.warn(
						`Dispatcher: ignoring new workFlow: "${wf._id}", because a matching workflow has been found: "${item._id}".`
					)
					finished()
					return
				}
				// Only for Quantel ... because CasparCG clip workflows might be re-initiated due to file delete
				if (item.finished && item.success === true && item.name && item.name.startsWith('quantel:')) {
					this.logger.warn(
						`Dispatcher: ignoring new workFlow: "${wf._id}", because a previous Quantel workflow has completed successfully: "${item._id}".`
					)
					finished()
					return
				}
				// TODO consider whether this is relevant for non-Quantel workflows as well
				if (item.finished && item.success !== true && item.name && item.name.startsWith('quantel:')) {
					// Allow the new workflow - try again on restarts - but delete the old one
					this.logger.warn(
						`Dispatcher: new Quantel workflow "${wf._id}" replaces failed workflow "${item._id}".`
					)
					const { error: delError } = await noTryAsync(() => this.workFlows.remove(item))
					if (delError) {
						this.logger.error(
							'Dispatcher: workflow replacement - failed to delete existing workflow: "${item._id}"',
							delError
						)
					}
					// Tidy up any related worksteps
					if (!stepCache) {
						const { result: stepDetails, error: stepError } = await noTryAsync(() =>
							this.workSteps.allDocs()
						)
						if (stepError) {
							this.logger.error(
								`Dispatcher: workstep replacement - failed to retrieve workstep identifiers`
							)
							stepCache = undefined
						} else {
							stepCache = stepDetails
						}
					}
					if (stepCache) {
						for (let row of stepCache.rows) {
							if (row.doc && row.doc._id.startsWith(item._id)) {
								const { error: delStepError } = await noTryAsync(() =>
									this.workSteps.remove(row.doc?._id ?? '', row.doc?._rev ?? '')
								)
								if (delStepError) {
									this.logger.error(
										`Dispatcher: workstep replacement - failed to delete workstep "${row.doc?._id}"`
									)
								}
							}
						}
					}
				}
			}
		}
		// Did not find an outstanding workflow with the same hash
		const { error: putError } = await noTryAsync(() => this.workFlows.put(wfDb))
		if (putError) {
			this.logger.error(`Dispatcher: new WorkFlow could not be added to queue: "${wf._id}"`, putError)
		} else {
			this.logger.debug(`Dispatcher: new WorkFlow successfully added to queue: "${wf._id}"`)

			// persist the workflow steps separately to db:
			await Promise.all(
				wf.steps.map(step => {
					const stepDb = extendMandadory<WorkStep, Omit<WorkStepDB, '_rev'>>(step, {
						_id: wfDb._id + '_' + randomId(),
						workFlowId: wfDb._id
					})
					stepDb.priority = wfDb.priority * stepDb.priority // make sure that a high priority workflow steps will have their priority increased
					stepDb.modified = getCurrentTime()
					this.logger.info(`persisting step: ${JSON.stringify(workStepToPlain(stepDb))}`)
					return noTryAsync(
						() => this.workSteps.put(workStepToPlain(stepDb) as WorkStepDB),
						err =>
							this.logger.error(
								`Dispatcher: failed to store workStep "${step.action}" of workFlow "${wf._id}"`,
								err
							)
					)
				})
			)
		} // puterror
		this.dispatchWork()
		finished()
	})

	/**
	 *  Returns the work-steps that are yet to be done and return them in order of
	 *  priority (highest first). Also checks that no other steps in the same workflow
	 *  are currently working.
	 */
	private async getOutstandingWork(): Promise<WorkStepDB[]> {
		const { result: idleHands, error: idleError } = await noTryAsync(() =>
			this.workSteps.find({
				selector: {
					status: WorkStepStatus.IDLE
				}
			})
		)
		if (idleError) {
			this.logger.error(`Dispatcher: error finding outstanding work`, idleError)
			throw idleError
		}
		const { result: runningHands, error: runningError } = await noTryAsync(() =>
			this.workSteps.find({
				selector: {
					status: WorkStepStatus.WORKING
				}
			})
		)
		if (runningError) {
			this.logger.error(`Dispatcher: error finding running work to filter outstanding work`, runningError)
			throw runningError
		}
		const steps: Array<WorkStepDB> = (idleHands.docs as object[]).map(item =>
			plainToWorkStep(item, this.availableStorage)
		)
		const running: Array<WorkStepDB> = (runningHands.docs as object[]).map(item =>
			plainToWorkStep(item, this.availableStorage)
		)
		const runningIds = new Set(running.map(step => step.workFlowId))
		return steps.filter(step => !runningIds.has(step.workFlowId)).sort((a, b) => b.priority - a.priority)
	}

	/**
	 * Cancel unfinished worksteps (to be run after startup)
	 * @private
	 * @return Promise<void>
	 * @memberof Dispatcher
	 */
	private async cancelLeftoverWorkSteps(): Promise<void> {
		const wfs: string[] = []
		const { result: brokenItems, error: findError } = await noTryAsync(() =>
			this.workSteps.find({
				selector: {
					status: WorkStepStatus.WORKING
				}
			})
		)
		if (findError) {
			this.logger.error(`Dispatcher: failed to find broken items`, findError)
			throw findError
		}

		const { error: updateError } = await noTryAsync(() =>
			Promise.all(
				brokenItems.docs.map(i =>
					updateDB(this.workSteps, i._id, i => {
						i.status = WorkStepStatus.ERROR
						i.modified = getCurrentTime()
						i.messages = _.union(i.messages || [], ['Working on shutdown, failed.'])
						if (wfs.indexOf(i._id) < 0) {
							wfs.push(i._id)
						}
						return i
					})
				)
			)
		)
		if (updateError) {
			this.logger.error(`Dispatcher: error during one or more broken items updates`, updateError)
		}

		const { error: blockError } = await noTryAsync(() =>
			Promise.all(brokenItems.docs.map(i => this.blockStepsInWorkFlow(i.workFlowId)))
		)
		if (blockError) {
			this.logger.error('Dispatcher: error blocking one or more broken workSteps', blockError)
		}

		const { error: cancelError } = await noTryAsync(() =>
			Promise.all(
				wfs.map(i =>
					updateDB(this.workFlows, i, wf => {
						wf.finished = true
						wf.success = false
						return wf
					})
				)
			)
		)
		if (cancelError) {
			this.logger.error(`Dispatcher: unable to cancel old workSteps`, cancelError)
		}
	}

	/**
	 * Set a step as WORKING
	 * @private
	 * @param  {string} stepId
	 * @return Promise<void>
	 * @memberof Dispatcher
	 */
	private async setStepWorking(stepId: string): Promise<void> {
		const { error } = await noTryAsync(() =>
			updateDB(this.workSteps, stepId, step => {
				step.status = WorkStepStatus.WORKING
				step.modified = getCurrentTime()
				return step
			})
		)
		if (error) {
			this.logger.error(`Dispatcher: set stgp to working failed for step "${stepId}"`, error)
			throw error
		}
	}

	/**
	 * Get all of the highest priority steps for each WorkFlow
	 * @param steps sorted array of steps
	 */
	private getFirstTaskForWorkFlows(steps: WorkStepDB[]): WorkStepDB[] {
		const firstSteps: {
			[key: string]: WorkStepDB
		} = {}
		steps.forEach(i => {
			if (!firstSteps[i.workFlowId]) {
				firstSteps[i.workFlowId] = i
			}
		})
		return _.values(firstSteps)
	}

	/**
	 * Block all idle steps in a workflow
	 * @param workFlowId
	 */
	private async blockStepsInWorkFlow(workFlowId: string, stepMessage?: string): Promise<void> {
		const { result, error: findError } = await noTryAsync(() =>
			this.workSteps.find({
				selector: {
					workFlowId: workFlowId
				}
			})
		)
		if (findError) {
			this.logger.error(
				`Dispatcher: find failed when trying to block steps for workFlow "${workFlowId}"`,
				findError
			)
			throw findError
		}
		const { error: updateError } = await noTryAsync(() =>
			Promise.all(
				result.docs
					.filter(item => item.status === WorkStepStatus.IDLE)
					.map(item => {
						return updateDB(this.workSteps, item._id, item => {
							item.status = WorkStepStatus.BLOCKED
							item.modified = getCurrentTime()
							if (stepMessage) item.messages = [stepMessage]
							return item
						})
					})
			)
		)
		if (updateError) {
			this.logger.error(
				`Dispatcher: update failed when trying to block steps for workFlow "${workFlowId}"`,
				updateError
			)
			throw updateError
		}
	}

	/**
	 * Check the result of a job (work) and then set the WorkStep status accordingly
	 * @param job
	 * @param result
	 */
	private async processResult(job: WorkStepDB, result: WorkResult): Promise<void> {
		switch (result.status) {
			case WorkStepStatus.CANCELED:
			case WorkStepStatus.ERROR:
				await noTryAsync(
					() => this.blockStepsInWorkFlow(job.workFlowId),
					err => this.logger.error(`Dispatcher: could not block outstanding work steps`, err)
				)
				break
		}

		await noTryAsync(
			() =>
				updateDB(this.workSteps, job._id, workStep => {
					workStep.status = result.status
					workStep.modified = getCurrentTime()
					workStep.messages = (workStep.messages || []).concat(result.messages || [])

					this.logger.debug(
						`Dispatcher: setting WorkStep "${job._id}" result to "${result.status}"` +
							(result.messages ? ', message: ' + result.messages.join(', ') : '')
					)
					return workStep
				}),
			err => this.logger.error(`Dispatcher: failed to update database after job "${job._id}"`, err)
		)
	}

	/**
	 * U pdate the status of all non-finished work-flows
	 */
	private async updateWorkFlowStatus(): Promise<void> {
		// Get all unfinished workFlows
		const { result: ongoingWork, error: findWFError } = await noTryAsync(() =>
			this.workFlows.find({
				selector: {
					finished: false
				}
			})
		)
		if (findWFError) {
			this.logger.error(`Dispatcher: could not find ongoing work`, findWFError)
			throw findWFError
		}

		await Promise.all(
			ongoingWork.docs.map(async (wf: WorkFlowDB) => {
				const { result: steps, error: findWSError } = await noTryAsync(() =>
					this.workSteps.find({
						selector: {
							workFlowId: wf._id
						}
					})
				)
				if (findWSError) {
					this.logger.error(
						`Dispatcher: failed to read workSteps when updating status for workFlow "${wf._id}"`,
						findWSError
					)
				}

				const isFinished = steps.docs.every(
					workStep => workStep.status !== WorkStepStatus.WORKING && workStep.status !== WorkStepStatus.IDLE
				)

				if (isFinished) {
					// if they are finished, check if all are DONE (not CANCELLED, ERROR or BLOCKED)
					const isSuccessful = steps.docs.every(
						workStep =>
							workStep.status === WorkStepStatus.DONE || workStep.status === WorkStepStatus.SKIPPED
					)

					const { error: updateError } = await noTryAsync(() =>
						updateDB(this.workFlows, wf._id, wf => {
							wf.finished = isFinished
							wf.success = isSuccessful
							wf.modified = getCurrentTime()
							return wf
						})
					)
					if (updateError) {
						this.logger.error(
							`Dispatcher: failed to save new WorkFlow "${wf._id}" state: ${wf.finished}`,
							updateError
						)
					} else {
						this.logger.info(
							`Dispatcher: workFlow ${wf._id} is now finished ${
								isSuccessful ? 'successfully' : 'unsuccessfully'
							}`
						)
					}
				}
			})
		)
	}

	/**
	 *  Assign outstanding work to available workers and process result
	 */
	private async dispatchWork(): Promise<void> {
		const { result: allJobs, error: outstandingError } = await noTryAsync(() => this.getOutstandingWork())
		if (outstandingError) throw outstandingError

		if (allJobs.length === 0) return
		this.logger.debug(`Dispatcher: got ${allJobs.length} outstanding jobs`)

		const jobs = this.getFirstTaskForWorkFlows(allJobs)

		for (let i = 0; i < this.workers.length; i++) {
			if (!this.workers[i].busy) {
				const nextJob = jobs.shift()
				if (!nextJob) return // No work is left to be assigned at this moment

				noTryAsync(
					// Don't await - set workers off in parallel
					() => this.doWorkWithWorker(this.workers[i], nextJob),
					error => {
						this.logger.error(
							`Dispatcher: there was an unhandled error when handling job "${nextJob._id}"`,
							error
						)
						this.workers[i].cooldown()
					}
				)
			}
		}
	}

	private async doWorkWithWorker(worker: Worker, job: WorkStepDB) {
		worker.warmup()
		await this.setStepWorking(job._id)
		let workResult = await worker.doWork(job as GeneralWorkStepDB)
		await this.processResult(job, workResult)
		await this.updateWorkFlowStatus() // Update unfinished WorkFlow statuses
		noTryAsync(
			() => this.watchdog(),
			error => this.logger.error(`Dispatcher: unhandled exception in watchdog`, error)
		)
		this.dispatchWork() // dispatch more work once this job is done
	}

	/**
	 *  Synchronize the WorkFlows databases with core after connecting
	 */
	private async initialWorkFlowSync(): Promise<void> {
		const {
			result: [coreObjects, allDocsResponse],
			error: queryError
		} = await noTryAsync(() =>
			Promise.all([
				this.coreHandler.core.callMethodLowPrio(MMPDMethods.getMediaWorkFlowRevisions),
				this.workFlows.allDocs<WorkFlowDB>({
					include_docs: true,
					attachments: false
				})
			])
		)
		if (queryError) {
			this.logger.error(`Dispatcher: failed in inital workFlow sync queries`, queryError)
			throw queryError
		}
		this.logger.info(
			'Dispatcher: workFlows: synchronizing objectlists',
			coreObjects.length,
			allDocsResponse.total_rows
		)

		let tasks: Array<() => Promise<void>> = []

		let coreObjRevisions: { [id: string]: string } = {}
		_.each(coreObjects, (obj: any) => {
			coreObjRevisions[obj._id] = obj.rev
		})
		tasks = tasks.concat(
			_.compact(
				_.map(
					allDocsResponse.rows.filter(i => i.doc && !(i.doc as any).views),
					doc => {
						const docId = doc.id

						if (doc.value.deleted) {
							return null // handled later
						} else if (
							!coreObjRevisions[docId] || // created
							coreObjRevisions[docId] !== doc.value.rev // changed
						) {
							delete coreObjRevisions[docId]

							return async (): Promise<void> => {
								const { result: doc, error: docError } = await noTryAsync(() =>
									this.workFlows.get<WorkFlowDB>(docId)
								)
								if (docError) {
									this.logger.error(
										`Dispatcher: workFlows: failed to retrieve document "${docId}" on sync operation`,
										docError
									)
									throw docError
								}
								await this.pushWorkFlowToCore(doc._id, doc)
								await wait(100) // slow it down a bit, maybe remove this later
							}
						} else {
							delete coreObjRevisions[docId] // identical
							return null
						}
					}
				)
			)
		)
		// The ones left in coreObjRevisions have not been touched, ie they should be deleted
		_.each(coreObjRevisions, (_rev, id) => {
			// deleted
			tasks.push(() => {
				return this.pushWorkFlowToCore(id, null)
			})
		})
		let allTasks = Promise.resolve()
		for (let task of tasks) {
			allTasks = allTasks.then(task)
		}
		await allTasks
		this.logger.info('Dispatcher: workFlows: done workFlow objects sync init')
	}

	/**
	 *  Synchronize the WorkFlows databases with core after connecting
	 */
	private async initialWorkStepsSync(): Promise<void> {
		const {
			result: [coreObjects, allDocsResponse],
			error: queryError
		} = await noTryAsync(() =>
			Promise.all([
				this.coreHandler.core.callMethodLowPrio(MMPDMethods.getMediaWorkFlowStepRevisions),
				this.workSteps.allDocs<WorkStepDB>({
					include_docs: true,
					attachments: false
				})
			])
		)
		if (queryError) {
			this.logger.error(`Dispatcher: failed in inital workStep sync queries`, queryError)
			throw queryError
		}

		// this.logger.info(`worksteps: ${JSON.stringify(allDocsResponse)}`)
		this.logger.info(
			`Dispatcher: workSteps: synchronizing objectlists ${coreObjects.length}=${allDocsResponse.total_rows}`
		)

		let tasks: Array<() => Promise<void>> = []

		let coreObjRevisions: { [id: string]: string } = {}
		_.each(coreObjects, (obj: any) => {
			coreObjRevisions[obj._id] = obj.rev
		})
		tasks = tasks.concat(
			_.compact(
				_.map(
					allDocsResponse.rows.filter(i => i.doc && !(i.doc as any).views),
					doc => {
						const docId = doc.id

						if (doc.value.deleted) {
							// deleted
							return null // handled later
						} else if (
							!coreObjRevisions[docId] || // created
							coreObjRevisions[docId] !== doc.value.rev // changed
						) {
							delete coreObjRevisions[docId]

							return async () => {
								const { result: doc, error: docError } = await noTryAsync(() =>
									this.workSteps.get<WorkStepDB>(docId)
								)
								if (docError) {
									this.logger.error(
										`Dispatcher: workSteps: failed to retrieve document "${docId}" on sync operation`,
										docError
									)
									throw docError
								}
								await this.pushWorkStepToCore(doc._id, doc)
								await wait(100) // slow it down a bit, maybe remove this later
							}
						} else {
							// identical
							delete coreObjRevisions[docId]
							return null
						}
					}
				)
			)
		)
		// The ones left in coreObjRevisions have not been touched, ie they should be deleted
		_.each(coreObjRevisions, (_rev, id) => {
			// deleted
			tasks.push(() => {
				return this.pushWorkStepToCore(id, null)
			})
		})

		let allTasks = Promise.resolve()
		for (let task of tasks) {
			allTasks = allTasks.then(task)
		}
		await allTasks
		this.logger.info('Dispatcher: workSteps: done workStep objects sync init')
	}

	private pushWorkFlowToCore = throttleOnKey(
		async (id: string, wf: WorkFlowDB | null) => {
			const { error } = await noTryAsync(() =>
				this.coreHandler.core.callMethod(MMPDMethods.updateMediaWorkFlow, [id, wf])
			)
			if (error) {
				this.logger.error(`Dispatcher: cound not update WorkFlow "${id}"`)
				throw error
			} else {
				this.logger.debug(`Dispatcher: workFlow in core "${id}" updated`)
			}
		},
		100,
		'pushWorkFlowToCore'
	)

	private pushWorkStepToCore = throttleOnKey(
		async (id: string, ws: WorkStepDB | null) => {
			const { error } = await noTryAsync(() =>
				this.coreHandler.core.callMethod(MMPDMethods.updateMediaWorkFlowStep, [id, ws])
			)
			if (error) {
				this.logger.error(`Dispatcher: could not update WorkStep "${id}" in Core`, error)
				throw error
			} else {
				this.logger.debug(`Dispatcher: step in core "${id}" updated`)
			}
		},
		100,
		'pushWorkStepToCore'
	)

	setQuantelMonitor(monitor: MonitorQuantel) {
		this.quantelMonitor = monitor
		this.workers.forEach(w => {
			w.setQuantelMonitor(this.quantelMonitor)
		})
	}
}
