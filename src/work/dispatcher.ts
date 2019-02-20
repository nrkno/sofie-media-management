import * as _ from 'underscore'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as fs from 'fs-extra'
import * as PromiseSequence from 'promise-sequence'
import * as request from 'request-promise-native'
import { EventEmitter } from 'events'

import { PeripheralDeviceAPI as P } from 'tv-automation-server-core-integration'

import { extendMandadory, randomId, LogEvents, getCurrentTime, getFlowHash, throttleOnKey, atomic } from '../lib/lib'
import { WorkFlow, WorkFlowDB, WorkStep, WorkStepStatus, DeviceSettings } from '../api'
import { WorkStepDB, workStepToPlain, plainToWorkStep, GeneralWorkStepDB } from './workStep'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from '../workflowGenerators/baseWorkFlowGenerator'
import { StorageObject } from '../storageHandlers/storageHandler'
import { Worker, WorkResult } from './worker'
import { TrackedMediaItems } from '../mediaItemTracker'
import { CoreHandler } from '../coreHandler'

const CRON_JOB_INTERVAL = 10 * 60 * 60 * 1000 // 10 hours (ms)

// TODO: Move this into server-core-integration
enum MMPDMethods {
	'getMediaWorkFlowRevisions' = 'peripheralDevice.mediaManager.getMediaWorkFlowRevisions',
	'updateMediaWorkFlow' = 'peripheralDevice.mediaManager.updateMediaWorkFlow',
	'getMediaWorkFlowStepRevisions' = 'peripheralDevice.mediaManager.getMediaWorkFlowStepRevisions',
	'updateMediaWorkFlowStep' = 'peripheralDevice.mediaManager.updateMediaWorkFlowStep'
}

/**
 * The dispatcher connects the storages to the workflow generators
 * And then dispathes the work to the workers
 */
export class Dispatcher extends EventEmitter {
	generators: BaseWorkFlowGenerator[]

	private _workers: Worker[] = []

	private _workFlows: PouchDB.Database<WorkFlowDB>
	private _workSteps: PouchDB.Database<WorkStepDB>
	private _availableStorage: StorageObject[]
	private _tmi: TrackedMediaItems
	private _config: DeviceSettings
	private _coreHandler: CoreHandler

	private _bestEffort: NodeJS.Timer | undefined = undefined
	private _workflowCleanUp: NodeJS.Timer | undefined = undefined

	private _cronJobTime: number
	private _workFlowLingerTime: number

	on (type: LogEvents, listener: (e: string) => void): this {
		return super.on(type, listener)
	}

	constructor (
		generators: BaseWorkFlowGenerator[],
		availableStorage: StorageObject[],
		tmi: TrackedMediaItems,
		config: DeviceSettings,
		workersCount: number,
		workFlowLingerTime: number,
		coreHandler: CoreHandler
	) {
		super()

		this.generators = generators
		this._tmi = tmi
		this._config = config
		this._coreHandler = coreHandler
		this.attachLogEvents('TrackedMediaItems', this._tmi)

		this._cronJobTime = config.cronJobTime || CRON_JOB_INTERVAL
		this._workFlowLingerTime = workFlowLingerTime

		fs.ensureDirSync('./db')
		PouchDB.plugin(PouchDBFind)
		const PrefixedPouchDB = PouchDB.defaults({
			prefix: './db/'
		} as any)

		this._workFlows = new PrefixedPouchDB('workFlows')
		this._workSteps = new PrefixedPouchDB('workSteps')

		this._availableStorage = availableStorage

		for (let i = 0; i < workersCount; i++) {
			const newWorker = new Worker(this._workSteps, this._tmi, this._config)
			this.attachLogEvents(`Worker ${i}`, newWorker)
			this._workers.push(newWorker)
		}
	}

	async init (): Promise<void> {
		return Promise.all([
			this._workFlows.createIndex({
				index: {
					fields: ['priority']
				}
			}).then(() => this._workFlows.createIndex({
				index: {
					fields: ['finished']
				}
			})).then(() => this._workFlows.createIndex({
				index: {
					fields: ['finished', 'created']
				}
			})).then(() => {
				this.emit('debug', `DB "workFlows" index "priority" succesfully created.`)
			}).catch((e) => {
				throw new Error(`Could not initialize "workFlows" database: ${e}`)
			}),
			this._workSteps.createIndex({
				index: {
					fields: ['workFlowId']
				}
			}).then(() => this._workSteps.createIndex({
				index: {
					fields: ['status']
				}
			})).then(() => {
				this.emit('debug', `DB "workSteps" index "priority" & "workFlowId" succesfully created.`)
			}).catch((e) => {
				throw new Error(`Could not initialize "workSteps" database: ${e}`)
			})
		]).then(() => this.initialWorkFlowAndStepsSync())
		.catch((e) => {
			this.emit('error', `Failed to synchronize with core`, e)
			process.exit(1)
			throw e
		}).then(() => {
			// Maintain one-to-many relationship for the WorkFlows and WorkSteps
			// Update WorkFlows and WorkSteps in Core
			this._workFlows.changes({
				since: 'now',
				live: true,
				include_docs: true
			}).on('change', (change) => {
				if (change.deleted) {
					this._workSteps.find({
						selector: {
							workFlowId: change.id
						}
					})
					.then((value) => {
						return Promise.all(value.docs.map(i => this._workSteps.remove(i)))
							.then(() => this.emit('debug', `Removed ${value.docs.length} orphaned WorkSteps for WorkFlow "${change.id}"`))
					})
					.catch(reason => this.emit('error', `Could not remove orphaned WorkSteps`, reason))

					this.pushWorkFlowToCore(change.id, null).catch(() => { })
				} else if (change.doc) {
					this.pushWorkFlowToCore(change.id, change.doc).catch(() => { })
				}
			}).on('error', (err) => {
				this.emit('error', `An error happened in the workFlow changes stream`, err)
			})
			this._workSteps.changes({
				since: 'now',
				live: true,
				include_docs: true
			}).on('change', (change) => {
				if (change.deleted) {
					this.pushWorkStepToCore(change.id, null).catch(() => { })
				} else if (change.doc) {
					this.pushWorkStepToCore(change.id, change.doc).catch(() => { })
				}
			})

			// clean up old work-flows every now and then
			this._workflowCleanUp = setInterval(() => {
				this._workFlows.find({
					selector: {
						created: { $lt: getCurrentTime() - this._workFlowLingerTime },
						finished: true
					}
				}).then((value) => {
					Promise.all(
						value.docs.map(i => {
							return this._workFlows.remove(i)
								.catch(e => this.emit('error', `Failed to remove stale workflow "${i._id}"`, e))
						})
					)
						.then(() => {
							this.emit('debug', `Removed ${value.docs.length} stale WorkFlows`)
						})
						.catch(e => this.emit('error', `Failed to remove stale workflows`, e))
				}, (reason) => {
					this.emit('error', `Could not get stale WorkFlows`, reason)
				})
			}, this._cronJobTime)
		})
		.then(() => this.setScannerManualMode(true))
		.then(() => this._coreHandler.setProcessState('MediaScanner', [], P.StatusCode.GOOD), (e) => {
			this.emit('debug', `Could not place media scanner in manual mode`, e)
			this._coreHandler.setProcessState('MediaScanner', [`Could not place media scanner in manual mode: ${JSON.stringify(e)}`], P.StatusCode.WARNING_MAJOR)
			this.scannerManualModeBestEffort(true)
		})
		.then(() => Promise.all(this._availableStorage.map(st => this.attachLogEvents(st.id, st.handler))))
		.then(() => Promise.all(this.generators.map(gen => this.attachLogEvents(gen.constructor.name, gen))))
		.then(() => Promise.all(this.generators.map(gen => gen.init()))).then(() => {
			this.emit('debug', `Dispatcher initialized.`)
		}).then(() => {
			this.generators.forEach((gen) => {
				gen.on(WorkFlowGeneratorEventType.NEW_WORKFLOW, this.onNewWorkFlow)
				this.attachLogEvents(`WorkFlowGenerator "${gen.constructor.name}"`, gen)
			})
		}).then(() => this.restartWorkSteps())
	}

	async destroy (): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.destroy()))
		.then(() => this.emit('debug', 'WorkFlow generators destroyed'))
		.then(() => { if (this._workflowCleanUp) clearInterval(this._workflowCleanUp) })
		.then(() => this.emit('debug', 'WorkFlow clean up task destroyed'))
		.then(() => Promise.all(this._availableStorage.map(st => st.handler.destroy())))
		.then(() => this.emit('debug', 'Storage handlers destroyed'))
		.then(() => this.setScannerManualMode(false))
		.catch((e) => this.emit('error', `Error when disabling manual mode in scanner`, e))
		.then(() => this.emit('debug', 'Scanner placed back in automatic mode'))
		.then(() => this.emit('debug', `Dispatcher destroyed.`))
		.then(() => { })
	}

	private attachLogEvents = (prefix: string, ee: EventEmitter) => {
		ee.removeAllListeners('error')
		.removeAllListeners('warn')
		.removeAllListeners('info')
		.removeAllListeners('debug')
		.on('error', (e, ...args: any[]) => this.emit('error', prefix + ': ' + e, ...args))
		.on('warn', (e, ...args: any[]) => this.emit('warn', prefix + ': ' + e, ...args))
		.on('info', (e, ...args: any[]) => this.emit('info', prefix + ': ' + e, ...args))
		.on('debug', (e, ...args: any[]) => this.emit('debug', prefix + ': ' + e, ...args))
	}

	/**
	 * Continously try to place media-scanner in manual mode and set status to GOOD once that's done
	 */
	private scannerManualModeBestEffort (manual: boolean) {
		this._bestEffort = undefined
		this.setScannerManualMode(manual).then(() => {
			this._coreHandler.setProcessState('MediaScanner', [], P.StatusCode.GOOD)
			this.emit('debug', `Scanner placed in manual mode`)
		}, () => {
			// this.emit('debug', `Could not place media scanner in manual mode: ${e}, will retry in 5s`)
			this._bestEffort = setTimeout(() => {
				this.scannerManualModeBestEffort(manual)
			}, 5000)
		})
	}

	/**
	 * Try to place media-scanner in manual mode and reject promise if fails
	 */
	private async setScannerManualMode (manual: boolean): Promise<object> {
		if (this._bestEffort !== undefined) {
			clearTimeout(this._bestEffort)
			this._bestEffort = undefined
		}
		return request(`http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/manualMode/${manual ? 'true' : 'false'}`).promise()
	}
	/**
	 * Called whenever there's a new workflow from a WorkflowGenerator
	 */
	private onNewWorkFlow = atomic((finished: () => void, wf: WorkFlow, generator: BaseWorkFlowGenerator) => {
		// TODO: This should also handle extra workflows using a hash of the basic WorkFlow object to check if there is a WORKING or IDLE workflow that is the same
		const hash = getFlowHash(wf)
		const wfDb: WorkFlowDB = _.omit(wf, 'steps')
		wfDb.hash = hash

		console.log(`Current hash: ${hash}`)

		this.emit('debug', `Dispatcher caught new workFlow: "${wf._id}" from ${generator.constructor.name}`)
		// persist workflow to db:
		this._workFlows.allDocs({
			include_docs: true
		}).then((docs) => {
			for (let i = 0; i < docs.rows.length; i++) {
				const item: WorkFlowDB | undefined = docs.rows[i].doc
				if (item === undefined) continue
				if (!item.finished && item.hash === hash) {
					this.emit('warn', `Ignoring new workFlow: "${wf._id}", because other workflow has been found: "${item._id}".`)
					finished()
					return
				}
			}
			// Did not find an outstanding workflow with the same hash
			this._workFlows.put(wfDb)
			.then(() => {
				this.emit('debug', `New WorkFlow successfully added to queue: "${wf._id}"`)
				// persist the workflow steps separately to db:
				return Promise.all(wf.steps.map(step => {
					const stepDb = extendMandadory<WorkStep, WorkStepDB>(step, {
						_id: wfDb._id + '_' + randomId(),
						workFlowId: wfDb._id
					})
					stepDb.priority = wfDb.priority * stepDb.priority // make sure that a high priority workflow steps will have their priority increased
					return this._workSteps.put(workStepToPlain(stepDb) as WorkStepDB)
				})).then(() => {
					finished()
				})
			}, (e) => {
				this.emit('error', `New WorkFlow could not be added to queue: "${wf._id}"`, e)
			}).then(() => {
				this.dispatchWork()
				finished()
			}).catch((e) => {
				this.emit('error', `Adding new WorkFlow to queue failed`, e)
				finished()
			})
		}).catch(() => {
			finished()
		})
	})
	/**
	 * Returns the work-steps that are yet to be done and return them in order of priority (highest first)
	 */
	private async getOutstandingWork (): Promise<WorkStepDB[]> {
		return this._workSteps.find({selector: {
			status: WorkStepStatus.IDLE
		}})
		.then((result) => {
			return (result.docs as object[]).map((item) => {
				return plainToWorkStep(item, this._availableStorage)
			})
		})
		.then((docs) => {
			return docs.sort((a, b) => b.priority - a.priority)
		})
	}
	/**
	 * Restart unfinished worksteps (to be run after startup)
	 * @private
	 * @return Promise<void>
	 * @memberof Dispatcher
	 */
	private async restartWorkSteps (): Promise<void> {
		const brokenItems = await this._workSteps.find({ selector: {
			status: WorkStepStatus.WORKING
		}})
		return Promise.all(brokenItems.docs.map(i => {
			i.status = WorkStepStatus.IDLE
			return this._workSteps.put(i)
		})).then(() => {
			this.dispatchWork()
		}).catch((e) => {
			this.emit('error', `Unable to restart old workSteps`, e)
		})
	}
	/**
	 * Set a step as WORKING
	 * @private
	 * @param  {string} stepId
	 * @return Promise<void>
	 * @memberof Dispatcher
	 */
	private async setStepWorking (stepId: string): Promise<void> {

		return putToDB(this._workSteps, stepId, (step) => {
			step.status = WorkStepStatus.WORKING
			return step
		})
		.then((step) => {
			// console.log('done update ' + step._id)
		})
		.catch((e) => {
			// console.log('Error in setStepWorking', e)
			throw e
		})
	}
	/**
	 * Get all of the highest priority steps for each WorkFlow
	 * @param steps sorted array of steps
	 */
	private getFirstTaskForWorkFlows (steps: WorkStepDB[]): WorkStepDB[] {
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
	private async blockStepsInWorkFlow (workFlowId: string): Promise<void> {
		return this._workSteps.find({
			selector: {
				workFlowId: workFlowId
			}
		})
		.then((result) => {
			return Promise.all(result.docs.map(item => {
				if (item.status === WorkStepStatus.IDLE) {
					item.status = WorkStepStatus.BLOCKED
					return this._workSteps.put(item).then(() => { })
				}
				return Promise.resolve()
			}))
		}).then(() => { })
	}
	/**
	 * Check the result of a job (work) and then set the WorkStep status accordingly
	 * @param job
	 * @param result
	 */
	private async processResult (job: WorkStepDB, result: WorkResult): Promise<void> {
		switch (result.status) {
			case WorkStepStatus.CANCELED:
			case WorkStepStatus.ERROR:
				try {
					await this.blockStepsInWorkFlow(job.workFlowId)
				} catch (e) {
					this.emit('error', `Could not block outstanding work steps`, e)
				}
				break
		}

		return putToDB(this._workSteps, job._id, (workStep) => {
			workStep.status = result.status
			workStep.messages = (workStep.messages || []).concat(result.messages || [])

			this.emit('debug', `Setting WorkStep "${job._id}" result to "${result.status}"` + (result.messages ? ', message: ' + result.messages.join(', ') : ''))
			return workStep
		})
		.then(() => { })
	}
	/**
	 * Update the status of all non-finished work-flows
	 */
	private async updateWorkFlowStatus (): Promise<void> {
		// Get all unfinished workFlows
		return this._workFlows.find({ selector: {
			finished: false
		}}).then((result) => {
			return Promise.all(result.docs.map(async (wf: WorkFlowDB) => {
				return this._workSteps.find({ selector: {
					workFlowId: wf._id
				}}).then((result) => {
					// Check if all WorkSteps are finished (not WORKING or IDLE)
					const isFinished = result.docs.reduce<boolean>((pV, workStep) => {
						return pV && (
							workStep.status !== WorkStepStatus.WORKING &&
							workStep.status !== WorkStepStatus.IDLE
						)
					}, true)

					if (isFinished) {
						// if they are finished, check if all are DONE (not CANCELLED, ERROR or BLOCKED)
						const isSuccessful = result.docs.reduce<boolean>((pV, workStep) => {
							return pV && (
								workStep.status === WorkStepStatus.DONE ||
								workStep.status === WorkStepStatus.SKIPPED
							)
						}, true)

						// update WorkFlow in DB
						return this._workFlows.get(wf._id)
						.then((obj) => {
							const wf = obj as object as WorkFlowDB
							wf.finished = isFinished
							wf.success = isSuccessful
							return this._workFlows.put(wf)
						})
						.then(() => this.emit('info', `WorkFlow ${wf._id} is now finished ${isSuccessful ? 'successfuly' : 'unsuccesfuly'}`))
						.catch((e) => {
							this.emit('error', `Failed to save new WorkFlow "${wf._id}" state: ${wf.finished}`, e)
						})
					}

					// if WorkFlow has unfinished WorkSteps, skip it
					return Promise.resolve()
				})
			})).then(() => {})
		}).catch((e) => {
			this.emit('error', `Failed to update WorkFlows' status`, e)
		})
	}
	/**
	 * Assign outstanding work to available workers and process result
	 */
	private dispatchWork () {
		this.getOutstandingWork().then((allJobs) => {
			if (allJobs.length === 0) return
			this.emit('debug', `Got ${allJobs.length} outstanding jobs`)

			const jobs = this.getFirstTaskForWorkFlows(allJobs)

			for (let i = 0; i < this._workers.length; i++) {
				if (!this._workers[i].busy) {
					const nextJob = jobs.shift()
					if (!nextJob) return // No work is left to be assigned at this moment
					this.setStepWorking(nextJob._id)
					.then(() => this._workers[i].doWork(nextJob as GeneralWorkStepDB))
					.then((result) => this.processResult(nextJob, result))
					.then(() => this.updateWorkFlowStatus()) // Update unfinished WorkFlow statuses
					.then(() => this.dispatchWork()) // dispatch more work once this job is done
					.catch(e => {
						this.emit('error', `There was an unhandled error when handling job "${nextJob._id}"`, e)
					})
				}
			}
		}, (e) => {
			throw new Error(`Could not get outstanding work from DB: ${e}`)
		})
	}
	/**
	 * Synchronize the WorkFlows and WorkSteps databases with core after connecting
	 */
	private initialWorkFlowAndStepsSync () {
		return Promise.all([
			this._coreHandler.core.callMethodLowPrio(MMPDMethods.getMediaWorkFlowRevisions),
			this._workFlows.allDocs({
				include_docs: true,
				attachments: false
			})
		])
		.then(([coreObjects, allDocsResponse]) => {

			this._coreHandler.logger.info('WorkFlows: synchronizing objectlists', coreObjects.length, allDocsResponse.total_rows)

			let tasks: Array<() => Promise<any>> = []

			let coreObjRevisions: { [id: string]: string } = {}
			_.each(coreObjects, (obj: any) => {
				coreObjRevisions[obj._id] = obj.rev
			})
			tasks = tasks.concat(_.compact(_.map(allDocsResponse.rows.filter(i => i.doc && !((i.doc as any).views)), (doc) => {
				const docId = doc.id

				if (doc.value.deleted) {
					if (coreObjRevisions[docId]) {
						// deleted
					}
					return null // handled later
				} else if (
					!coreObjRevisions[docId] ||				// created
					coreObjRevisions[docId] !== doc.value.rev	// changed
				) {
					delete coreObjRevisions[docId]

					return () => {
						return this._workFlows.get(doc.id).then((doc) => {
							return this.pushWorkFlowToCore(doc._id, doc)
						})
						.then(() => {
							return new Promise(resolve => {
								setTimeout(resolve, 100) // slow it down a bit, maybe remove this later
							})
						})
					}
				} else {
					delete coreObjRevisions[docId]
					// identical
					return null
				}
			})))
			// The ones left in coreObjRevisions have not been touched, ie they should be deleted
			_.each(coreObjRevisions, (_rev, id) => {
				// deleted

				tasks.push(() => {
					return this.pushWorkFlowToCore(id, null)
				})
			})
			return PromiseSequence(tasks)
		})
		.then(() => {
			this._coreHandler.logger.info('WorkFlows: Done objects sync init')
			return
		})
		.then(() => Promise.all([
			this._coreHandler.core.callMethodLowPrio(MMPDMethods.getMediaWorkFlowStepRevisions),
			this._workSteps.allDocs({
				include_docs: true,
				attachments: false
			})
		]))
		.then(([coreObjects, allDocsResponse]) => {

			this._coreHandler.logger.info('WorkSteps: synchronizing objectlists', coreObjects.length, allDocsResponse.total_rows)

			let tasks: Array<() => Promise<any>> = []

			let coreObjRevisions: { [id: string]: string } = {}
			_.each(coreObjects, (obj: any) => {
				coreObjRevisions[obj._id] = obj.rev
			})
			tasks = tasks.concat(_.compact(_.map(allDocsResponse.rows.filter(i => i.doc && !((i.doc as any).views)), (doc) => {
				const docId = doc.id

				if (doc.value.deleted) {
					if (coreObjRevisions[docId]) {
						// deleted
					}
					return null // handled later
				} else if (
					!coreObjRevisions[docId] ||				// created
					coreObjRevisions[docId] !== doc.value.rev	// changed
				) {
					delete coreObjRevisions[docId]

					return () => {
						return this._workSteps.get(doc.id).then((doc) => {
							return this.pushWorkStepToCore(doc._id, doc)
						})
						.then(() => {
							return new Promise(resolve => {
								setTimeout(resolve, 100) // slow it down a bit, maybe remove this later
							})
						})
					}
				} else {
					delete coreObjRevisions[docId]
					// identical
					return null
				}
			})))
			// The ones left in coreObjRevisions have not been touched, ie they should be deleted
			_.each(coreObjRevisions, (_rev, id) => {
				// deleted

				tasks.push(() => {
					return this.pushWorkStepToCore(id, null)
				})
			})
			return PromiseSequence(tasks)
		})
		.then(() => {
			this._coreHandler.logger.info('WorkSteps: Done objects sync init')
			return
		})
	}

	private pushWorkFlowToCore = throttleOnKey((id: string, wf: WorkFlowDB | null) => {
		return this._coreHandler.core.callMethodLowPrio(MMPDMethods.updateMediaWorkFlow, [ id, wf ])
		.then(() => {
			this.emit('debug', `WorkFlow in core "${id}" updated`)
		})
		.catch((e) => {
			this.emit('error', `Could not update WorkFlow "${id}" in Core`, e)
		})
	}, 1000, 'pushWorkFlowToCore')

	private pushWorkStepToCore = throttleOnKey((id: string, ws: WorkStepDB | null) => {
		return this._coreHandler.core.callMethodLowPrio(MMPDMethods.updateMediaWorkFlowStep, [id, ws])
		.then(() => {
			this.emit('debug', `Step in core "${id}" updated`)
		})
		.catch((e) => {
			this.emit('error', `Could not update WorkStep "${id}" in Core`, e)
		})
	}, 1000, 'pushWorkStepToCore')
}
