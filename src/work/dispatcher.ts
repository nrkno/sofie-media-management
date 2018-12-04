import { EventEmitter } from 'events'
import * as Winston from 'winston'
import { StorageObject } from '../storageHandlers/storageHandler'
import { CoreHandler } from '../coreHandler'
import { TrackedMediaItems } from '../mediaItemTracker'
import { BaseWorkFlowGenerator } from '../workflowGenerators/baseWorkFlowGenerator';

export class Dispatcher extends EventEmitter {
	logger: Winston.LoggerInstance
	private _availableStorage: StorageObject[]
	private _core: CoreHandler
	private _tracked: TrackedMediaItems

	generators: BaseWorkFlowGenerator[]

	constructor (logger: Winston.LoggerInstance, availableStorage: StorageObject[], coreHandler: CoreHandler, tracked: TrackedMediaItems, generators: BaseWorkFlowGenerator[]) {
		super()

		this.logger = logger
		this._availableStorage = availableStorage
		this._core = coreHandler
		this._tracked = tracked
		this.generators = generators
	}

	async init (): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.init())).then(() => {
			this.logger.info(`Dispatcher initialized.`)
		})
	}

	async destroy(): Promise<void> {
		return Promise.all(this.generators.map(gen => gen.destroy())).then(() => {
			this.logger.info(`Dispatcher destroyed.`)
		})
	}
}
