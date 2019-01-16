import * as _ from 'underscore'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as fs from 'fs-extra'
import * as request from 'request-promise-native'
import { EventEmitter } from 'events'

import { extendMandadory, randomId, LogEvents } from '../lib/lib'
import { WorkFlow, WorkFlowDB, WorkStep, WorkStepStatus, DeviceSettings } from '../api'
import { WorkStepDB, workStepToPlain, plainToWorkStep, GeneralWorkStepDB } from './workStep'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from '../workflowGenerators/baseWorkFlowGenerator'
import { StorageObject } from '../storageHandlers/storageHandler'
import { Worker, WorkResult } from './worker'
import { TrackedMediaItems } from '../mediaItemTracker'

export class Dispatcher extends EventEmitter {
	generators: BaseWorkFlowGenerator[]

	private _workers: Worker[] = []

	private _workFlows: PouchDB.Database<WorkFlowDB>
	private _workSteps: PouchDB.Database<WorkStepDB>
	private _availableStorage: StorageObject[]
	private _tmi: TrackedMediaItems
	private _config: DeviceSettings

	private _bestEffort: NodeJS.Timer | undefined = undefined

	on (type: LogEvents, listener: (e: string) => void): this {
		return super.on(type, listener)
	}

	constructor (generators: BaseWorkFlowGenerator[], availableStorage: StorageObject[], tmi: TrackedMediaItems, config: DeviceSettings, workersCount: number) {
		super()

		this.generators = generators
		this._tmi = tmi
		this._config = config
		this.attachLogEvents('TrackedMediaItems', this._tmi)

		fs.ensureDirSync('./db')
		PouchDB.plugin(PouchDBFind)
		const PrefixedPouchDB = PouchDB.defaults({
			prefix: './db/'
		} as any)

		this._workFlows = new PrefixedPouchDB('workFlows')
		this._workFlows.createIndex({ index: {
			fields: ['priority']
		}}).then(() => this._workFlows.createIndex({ index: {
			fields: ['finished']
		}})).then(() => {
			this.emit('debug', `DB "workFlows" index "priority" succesfully created.`)
		}).catch((e) => {
			throw new Error(`Could not initialize "workFlows" database: ${e}`)
		})
		this._workSteps = new PrefixedPouchDB('workSteps')
		this._workSteps.createIndex({ index: {
			fields: ['workFlowId']
		}}).then(() => this._workSteps.createIndex({ index: {
			fields: ['status']
		}})).then(() => {
			this.emit('debug', `DB "workSteps" index "priority" & "workFlowId" succesfully created.`)
		}).catch((e) => {
			throw new Error(`Could not initialize "workSteps" database: ${e}`)
		})

		this._availableStorage = availableStorage

		for (let i = 0; i < workersCount; i++) {
			const newWorker = new Worker(this._workSteps, this._tmi, this._config)
			this.attachLogEvents(`Worker ${i}`, newWorker)
			this._workers.push(newWorker)
		}
	}

	scannerManualModeBestEffort (manual: boolean) {
		this._bestEffort = undefined
		this.scannerManualMode(manual).then(() => {
			this.emit('debug', `Scanner placed in manual mode`)
		}, (e) => {
			this.emit('debug', `Could not place media scanner in manual mode: ${e}, will retry in 5s`)
			this._bestEffort = setTimeout(() => {
				this.scannerManualModeBestEffort(manual)
			}, 5000)
		})
	}

	async scannerManualMode (manual: boolean): Promise<object> {
		if (this._bestEffort !== undefined) {
			clearTimeout(this._bestEffort)
			this._bestEffort = undefined
		}
		return request(`http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/manualMode/${manual ? 'true' : 'false'}`).promise()
	}

	async init (): Promise<void> {
		return this.scannerManualMode(true)
		.catch((e) => {
			this.emit('debug', `Could not place media scanner in manual mode: ${e}`)
			this.scannerManualModeBestEffort(true)
		}).then(() => Promise.all(this.generators.map(gen => gen.init()))).then(() => {
			this.emit('debug', `Dispatcher initialized.`)
		}).then(() => {
			this.generators.forEach((gen) => {
				gen.on(WorkFlowGeneratorEventType.NEW_WORKFLOW, this.onNewWorkFlow)
				this.attachLogEvents(`WorkFlowGenerator "${gen.constructor.name}"`, gen)
			})
		})
	}

	async destroy (): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.destroy()))
		.then(() => this.emit('debug', 'WorkFlow generators destroyed'))
		.then(() => Promise.all(this._availableStorage.map(st => st.handler.destroy())))
		.then(() => this.emit('debug', 'Storage handlers destroyed'))
		.then(() => this.scannerManualMode(false))
		.catch((e) => this.emit('error', `Error when disabling manual mode in scanner: ${e}`))
		.then(() => this.emit('debug', 'Scanner placed back in automatic mode'))
		.then(() => this.emit('debug', `Dispatcher destroyed.`))
		.then(() => { })
	}

	private attachLogEvents = (prefix: string, ee: EventEmitter) => {
		ee.removeAllListeners('error')
		.removeAllListeners('warn')
		.removeAllListeners('info')
		.removeAllListeners('debug')
		.on('error', (e) => this.emit('error', prefix + ': ' + e))
		.on('warn', (e) => this.emit('warn', prefix + ': ' + e))
		.on('info', (e) => this.emit('info', prefix + ': ' + e))
		.on('debug', (e) => this.emit('debug', prefix + ': ' + e))
	}

	private onNewWorkFlow = (wf: WorkFlow, generator: BaseWorkFlowGenerator) => {
		const workFlowDb: WorkFlowDB = _.omit(wf, 'steps')
		this.emit('debug', `Dispatcher caught new workFlow: "${wf._id}" from ${generator.constructor.name}`)
		this._workFlows.put(workFlowDb).then(() => {
			this.emit('debug', `New WorkFlow successfully added to queue: "${wf._id}"`)
			return Promise.all(wf.steps.map(step => {
				const stepDb = extendMandadory<WorkStep, WorkStepDB>(step, {
					_id: workFlowDb._id + '_' + randomId(),
					workFlowId: workFlowDb._id
				})
				stepDb.priority = workFlowDb.priority * stepDb.priority
				return this._workSteps.put(workStepToPlain(stepDb) as WorkStepDB)
			}))
		}, (e) => {
			this.emit('error', `New WorkFlow could not be added to queue: "${wf._id}": ${e}`)
		}).then(() => {
			this.dispatchWork()
		}).catch((e) => {
			this.emit('error', `Adding new WorkFlow to queue failed: ${e}`)
		})
	}

	private async getOutstandingWork (): Promise<WorkStepDB[]> {
		return this._workSteps.find({selector: {
			status: WorkStepStatus.IDLE
		}}).then((result) => {
			return (result.docs as object[]).map((item) => {
				return plainToWorkStep(item, this._availableStorage)
			})
		}).then((docs) => {
			return docs.sort((a, b) => b.priority - a.priority)
		})
	}

	private getOnlyHighestPrio (docs: WorkStepDB[]): WorkStepDB[] {
		const onlyHighestOnes: {
			[key: string]: WorkStepDB
		} = {}
		docs.forEach(i => {
			if (!onlyHighestOnes[i.workFlowId]) {
				onlyHighestOnes[i.workFlowId] = i
			}
		})
		return _.values(onlyHighestOnes)
	}

	private async blockStepsInWorkFlow (workFlowId: string): Promise<void> {
		return this._workSteps.find({
			selector: {
				workFlowId: workFlowId
			}
		}).then((result) => {
			return Promise.all(result.docs.map(item => {
				if (item.status === WorkStepStatus.IDLE) {
					item.status = WorkStepStatus.BLOCKED
					return this._workSteps.put(item).then(() => { })
				}
				return Promise.resolve()
			}))
		}).then(() => { })
	}

	private async processResult (job: WorkStepDB, result: WorkResult): Promise<void> {
		switch (result.status) {
			case WorkStepStatus.CANCELED:
			case WorkStepStatus.ERROR:
				try {
					await this.blockStepsInWorkFlow(job.workFlowId)
				} catch (e) {
					this.emit('error', `Could not block outstanding work steps: ${e}`)
				}
				break
		}

		const workStep = await this._workSteps.get(job._id)
		workStep.status = result.status
		workStep.messages = (workStep.messages || []).concat(result.messages || [])

		this.emit('debug', `Setting WorkStep "${job._id}" result to "${result.status}"` + (result.messages ? ': ' : '') + (result.messages || []).join(', '))
		return this._workSteps.put(workStep).then(() => { })
	}

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
					const isFinished = result.docs.reduce<boolean>((pV, item) => {
						return pV && (
							(item.status !== WorkStepStatus.WORKING) &&
							(item.status !== WorkStepStatus.IDLE)
						)
					}, true)

					if (isFinished) {
						// if they are finished, check if all are DONE (not CANCELLED, ERROR or BLOCKED)
						const isSuccessful = result.docs.reduce<boolean>((pV, item) => {
							return pV && (
								(item.status === WorkStepStatus.DONE)
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
							this.emit('error', `Failed to save new WorkFlow "${wf._id}" state: ${wf.finished}: ${e}`)
						})
					}

					// if WorkFlow has unfinished WorkSteps, skip it
					return Promise.resolve()
				})
			})).then(() => {})
		}).catch((e) => {
			this.emit('error', `Failed to update WorkFlows' status: ${e}`)
		})
	}

	private dispatchWork () {
		this.getOutstandingWork().then((allJobs) => {
			if (allJobs.length === 0) return
			this.emit('debug', `Got ${allJobs.length} outstanding jobs`)

			const jobs = this.getOnlyHighestPrio(allJobs)

			for (let i = 0; i < this._workers.length; i++) {
				if (!this._workers[i].busy) {
					const nextJob = jobs.shift()
					if (!nextJob) return // No work is left to be assigned at this moment
					this._workers[i].doWork(nextJob as GeneralWorkStepDB)
					.then((result) => this.processResult(nextJob, result))
					.then(() => this.updateWorkFlowStatus()) // Update unfinished WorkFlow statuses
					.then(() => this.dispatchWork()) // dispatch more work once this job is done
					.catch(e => {
						this.emit('error', `There was an unhandled error when handling job "${nextJob._id}": ${e}`)
					})
				}
			}
		}, (e) => {
			throw new Error(`Could not get outstanding work from DB: ${e}`)
		})
	}
}
