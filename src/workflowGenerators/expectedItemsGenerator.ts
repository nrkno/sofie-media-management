import * as PouchDB from 'pouchdb-node'
import { BaseWorkFlowGenerator } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import { ExpectedMediaItem } from '../api'

export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler
	private _db: PouchDB.Database

	constructor (coreHandler: CoreHandler, database: PouchDB.Database) {
		super()
		this._coreHandler = coreHandler
		this._db = database
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
