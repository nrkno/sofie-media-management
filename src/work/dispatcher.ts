import * as _ from 'underscore'
import * as Winston from 'winston'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as fs from 'fs-extra'
import { EventEmitter } from 'events'

import { extendMandadory, randomId } from '../lib/lib'
import { WorkFlow, WorkFlowDB, WorkStepBase, WorkStepStatus } from '../api'
import { WorkStep, workStepToPlain, plainToWorkStep } from './workStep'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from '../workflowGenerators/baseWorkFlowGenerator'
import { StorageObject } from '../storageHandlers/storageHandler'
import { Worker, WorkResult } from './worker'
import { TrackedMediaItems } from '../mediaItemTracker'

export class Dispatcher extends EventEmitter {
	logger: Winston.LoggerInstance

	generators: BaseWorkFlowGenerator[]

	private _workers: Worker[] = []

	private _workFlows: PouchDB.Database<WorkFlowDB>
	private _workSteps: PouchDB.Database<WorkStep>
	private _availableStorage: StorageObject[]
	private _tmi: TrackedMediaItems

	constructor (logger: Winston.LoggerInstance, generators: BaseWorkFlowGenerator[], availableStorage: StorageObject[], tmi: TrackedMediaItems, workersCount: number) {
		super()

		this.logger = logger
		this.generators = generators
		this._tmi = tmi

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
			this.logger.debug(`DB "workFlows" index "priority" succesfully created.`)
		}).catch((e) => {
			throw new Error(`Could not initialize "workFlows" database: ${e}`)
		})
		this._workSteps = new PrefixedPouchDB('workSteps')
		this._workSteps.createIndex({ index: {
			fields: ['workFlowId']
		}}).then(() => this._workSteps.createIndex({ index: {
			fields: ['status']
		}})).then(() => {
			this.logger.debug(`DB "workSteps" index "priority" & "workFlowId" succesfully created.`)
		}).catch((e) => {
			throw new Error(`Could not initialize "workSteps" database: ${e}`)
		})

		this._availableStorage = availableStorage

		for (let i = 0; i < workersCount; i++) {
			const newWorker = new Worker(this.logger, this._workSteps, this._tmi)
			this._workers.push(newWorker)
		}
	}

	async init (): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.init())).then(() => {
			this.logger.debug(`Dispatcher initialized.`)
		}).then(() => {
			this.generators.forEach((gen) => {
				gen.on(WorkFlowGeneratorEventType.NEW_WORKFLOW, this.onNewWorkFlow)
			})
		})
	}

	async destroy (): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.destroy())).then(() => {
			this.logger.debug(`Dispatcher destroyed.`)
		})
	}

	private onNewWorkFlow = (wf: WorkFlow) => {
		const workFlowDb: WorkFlowDB = _.omit(wf, 'steps')
		this.logger.debug(`Dispatcher caught new workFlow: "${wf._id}"`)
		this._workFlows.put(workFlowDb).then(() => {
			this.logger.debug(`New WorkFlow successfully added to queue: "${wf._id}"`)
			return Promise.all(wf.steps.map(step => {
				const stepDb = extendMandadory<WorkStepBase, WorkStep>(step, {
					_id: workFlowDb._id + '_' + randomId(),
					workFlowId: workFlowDb._id
				})
				return this._workSteps.put(workStepToPlain(stepDb) as WorkStep)
			}))
		}, (e) => {
			this.logger.error(`New WorkFlow could not be added to queue: "${wf._id}": ${e}`)
		}).then(() => {
			this.dispatchWork()
		}).catch((e) => {
			this.logger.error(`Adding new WorkFlow to queue failed: ${e}`)
		})
	}

	private async getOutstandingWork (): Promise<WorkStep[]> {
		return this._workSteps.find({selector: {
			status: WorkStepStatus.IDLE
		}}).then((result) => {
			return (result.docs as object[]).map((item) => {
				return plainToWorkStep(item, this._availableStorage)
			})
		})
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

	private async processResult (job: WorkStep, result: WorkResult): Promise<void> {
		switch (result.status) {
			case WorkStepStatus.CANCELED:
			case WorkStepStatus.ERROR:
			try {
				await this.blockStepsInWorkFlow(job.workFlowId)
			} catch (e) {
				this.logger.error(`Could not block outstanding work steps: ${e}`)
			}
			break
		}
			
		const workStep = await this._workSteps.get(job._id)
		workStep.status = result.status
		workStep.messages = (workStep.messages || []).concat(result.messages || [])

		this.logger.debug(`Setting WorkStep "${job._id}" result to "${result.status}"` + (result.messages ? ': ' : '') + (result.messages || []).join(', '))
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
							this._workFlows.put(wf)
						})
						.then(() => this.logger.info(`WorkFlow ${wf._id} is now finished ${isSuccessful ? 'successfuly' : 'unsuccesfuly'}`))
						.catch((e) => {
							this.logger.error(`Failed to save new WorkFlow "${wf._id}" state: ${wf.finished}: ${e}`)
						})
					}

					// if WorkFlow has unfinished WorkSteps, skip it
					return Promise.resolve()
				})
			})).then(() => {})
		}).catch((e) => {
			this.logger.error(`Failed to update WorkFlows' status: ${e}`)
		})
	}

	private dispatchWork () {
		this.getOutstandingWork().then((jobs) => {
			this.logger.debug(`Got ${jobs.length} outstanding jobs`)
			if (jobs.length === 0) return

			for (let i = 0; i < this._workers.length; i++) {
				if (!this._workers[i].busy) {
					const nextJob = jobs.shift()
					if (!nextJob) return // No work is left to be assigned at this moment
					this._workers[i].doWork(nextJob)
					.then((result) => this.processResult(nextJob, result))
					.then(() => this.updateWorkFlowStatus()) // Update unfinished WorkFlow statuses
					.then(() => this.dispatchWork()) // dispatch more work once this job is done
					.catch(e => {
						this.logger.error(`There was an unhandled error when handling job "${nextJob._id}": ${e}`)
					})
				}
			}
		}, (e) => {
			throw new Error(`Could not get outstanding work from DB: ${e}`)
		})
	}
}
