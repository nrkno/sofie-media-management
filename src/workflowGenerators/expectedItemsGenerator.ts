import * as Winston from 'winston'
import { BaseWorkFlowGenerator } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import { ExpectedMediaItem } from '../api'
import { TrackedMediaItems } from '../mediaItemTracker'
import { StorageObject } from '../storageHandlers/storageHandler'

export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler
	private _tracked: TrackedMediaItems
	logger: Winston.LoggerInstance

	constructor (logger: Winston.LoggerInstance, availableStorage: StorageObject[], coreHandler: CoreHandler, tracked: TrackedMediaItems) {
		super()
		this._coreHandler = coreHandler
		this._tracked = tracked
		this.logger = logger
	}

	async getCoreExpectedMediaItems (): Promise<Array<ExpectedMediaItem>> {
		return await this._coreHandler.core.callMethodLowPrio('getExpectedMediaItems') as Array<ExpectedMediaItem>
	}

	async ingestExpectedItems (items: Array<ExpectedMediaItem>): Promise<void> {
		// TODO: process expected items
	}

	async init (): Promise<void> {
		return Promise.resolve()
	}

	async destroy (): Promise<void> {
		return Promise.resolve()
	}
}
