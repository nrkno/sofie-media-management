import * as Winston from 'winston'
import { BaseWorkFlowGenerator } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import { ExpectedMediaItem, MediaFlow } from '../api'
import { TrackedMediaItems } from '../mediaItemTracker'
import { StorageObject } from '../storageHandlers/storageHandler'

export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler
	private _tracked: TrackedMediaItems
	private _availableStorage: StorageObject[]
	private _flows: MediaFlow[]
	logger: Winston.LoggerInstance

	constructor(availableStorage: StorageObject[], tracked: TrackedMediaItems, flows: MediaFlow[], coreHandler: CoreHandler) {
		super()
		this._availableStorage = availableStorage
		this._coreHandler = coreHandler
		this._tracked = tracked
		this._flows = flows
	}

	async getCoreExpectedMediaItems (): Promise<Array<ExpectedMediaItem>> {
		return await this._coreHandler.core.callMethodLowPrio('getExpectedMediaItems') as Array<ExpectedMediaItem>
	}

	async ingestExpectedItems (items: Array<ExpectedMediaItem>): Promise<void> {
		// TODO: process expected items
	}

	async init (): Promise<void> {
		return Promise.resolve().then(() => {
			this._coreHandler.core.getCollection('expectedMediaItems')
		})
	}

	async destroy (): Promise<void> {
		return Promise.resolve()
	}
}
