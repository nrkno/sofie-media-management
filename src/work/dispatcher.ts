import * as _ from 'underscore'
import * as Winston from 'winston'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
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

	private _workFlows: PouchDB.Database
	private _workSteps: PouchDB.Database
	private _availableStorage: StorageObject[]
	private _tmi: TrackedMediaItems

	constructor (logger: Winston.LoggerInstance, generators: BaseWorkFlowGenerator[], availableStorage: StorageObject[], tmi: TrackedMediaItems, workersCount: number) {
		super()

		this.logger = logger
		this.generators = generators
		this._tmi = tmi

		PouchDB.plugin(PouchDBFind)
		const PrefixedPouchDB = PouchDB.defaults({
			prefix: './db/'
		} as any)

		this._workFlows = new PrefixedPouchDB('workFlows')
		this._workFlows.createIndex({ index: {
			fields: ['priority']
		}}).then(() => {
			this.logger.debug(`DB "workFlows" index "priority" succesfully created.`)
		}).catch((e) => {
			throw new Error(`Could not initialize "workFlows" database: ${e}`)
		})
		this._workSteps = new PrefixedPouchDB('workSteps')
		this._workSteps.createIndex({ index: {
			fields: ['workFlowId']
		}}).then(() => {
			return this._workSteps.createIndex({ index: {
				fields: ['status']
			}})
		}).then(() => {
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

	onNewWorkFlow = (wf: WorkFlow) => {
		const workFlowDb: WorkFlowDB = _.omit(wf, 'steps')
		this.logger.debug(`Dispatcher caught new workFlow: "${wf._id}"`)
		this._workFlows.put(workFlowDb).then(() => {
			this.logger.debug(`New WorkFlow successfully added to queue: "${wf._id}"`)
			return Promise.all(wf.steps.map(step => {
				const stepDb = extendMandadory<WorkStepBase, WorkStep>(step, {
					_id: workFlowDb._id + '_' + randomId(),
					workFlowId: workFlowDb._id
				})
				return this._workSteps.put(workStepToPlain(stepDb))
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
			const otherJobs = result.docs as WorkStep[]
			return Promise.all(otherJobs.map(item => {
				if (item.status === WorkStepStatus.IDLE) {
					item.status = WorkStepStatus.BLOCKED
					return this._workSteps.put(item).then(() => { return })
				}
				return Promise.resolve()
			}))
		}).then(() => { return })
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
			
		const workStep = await this._workSteps.get(job._id) as WorkStep
		workStep.status = result.status
		workStep.messages = (workStep.messages || []).concat(result.messages || [])

		this.logger.debug(`Setting WorkStep "${job._id}" result to "${result.status}"`)
		return this._workSteps.put(workStep).then(() => { return })
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
