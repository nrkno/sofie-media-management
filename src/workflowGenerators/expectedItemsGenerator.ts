import { BaseWorkFlowGenerator } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import { ExpectedMediaItem } from '../api'

export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler

	constructor (coreHandler: CoreHandler) {
		super()
		this._coreHandler = coreHandler
	}

	async getCoreExpectedMediaItems (): Promise<Array<ExpectedMediaItem>> {
		return await this._coreHandler.core.callMethodLowPrio('getExpectedMediaItems') as Array<ExpectedMediaItem>
	}

	async init (): Promise<void> {
		return Promise.resolve()
	}
}
