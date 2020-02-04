import { LoggerInstance } from 'winston'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as _ from 'underscore'
import * as fs from 'fs-extra'
import { Time, Duration } from './api'
import { putToDBUpsert } from './lib/lib'
import { noTryAsync } from 'no-try'

export interface TrackedMediaItem extends PouchDB.Core.IdMeta {
	_id: string

	expectedMediaItemId?: string[]

	sourceStorageId?: string
	targetStorageIds: string[]

	name: string
	comment?: string
	lastSeen: Time
	lingerTime: Duration
}

export interface TrackedMediaItemDB extends TrackedMediaItem, PouchDB.Core.GetMeta {
	_rev: string
}

export class TrackedMediaItems {
	private db: PouchDB.Database<TrackedMediaItem>

	constructor(
		private logger: LoggerInstance,
		dbAdapter?: string,
		dbPrefix?: string
	) {
		this.initDB(dbAdapter, dbPrefix)
	}

	private async initDB(dbAdapter?: string, dbPrefix?: string): Promise<void> {
		const { error } = await noTryAsync(async () => {
			PouchDB.plugin(PouchDBFind)
			await fs.ensureDir(dbPrefix || './db')
			const PrefixedPouchDB = PouchDB.defaults({
				prefix: dbPrefix || './db/'
			} as any)

			this.db = new PrefixedPouchDB('trackedMediaItems', {
				adapter: dbAdapter
			})
			await this.db.compact()
			await this.db.createIndex({
				index: {
					fields: ['sourceStorageId']
				}
			})
			await this.db.createIndex({
				index: {
					fields: ['mediaFlowId']
				}
			})
		})
		if (error) {
			this.logger.error('Tracked Media Items: failed to initialize database', error)
		}
	}

	/**
	 * Find an item of a given ID, transform it using the delta function and store it in the DB
	 * If the item is not found (to be inserted), undefined will be sent to delta-function
	 * If undefined is returned from delta-function, no update will be made
	 */
	async upsert(
		id: string,
		delta: (tmi?: TrackedMediaItem) => TrackedMediaItemDB | undefined
	): Promise<TrackedMediaItem | undefined> {
		return putToDBUpsert(
			this.db,
			id,
			(original?: TrackedMediaItemDB): TrackedMediaItem | undefined => {
				const modified: TrackedMediaItemDB | undefined = delta(original)
				if (original && modified) {
					modified._id = original._id
					modified._rev = original._rev
				}
				return modified
			})
	}

	async put(tmi: TrackedMediaItem): Promise<string> { // Expected to throw on error
		const result = await this.db.put(tmi)
		return result.id
	}

	async getById(id: string): Promise<TrackedMediaItemDB> { // Expected to throw on error
		const result = await this.db.get(id)
		return result
	}

	async getAllFromStorage(storageId: string, query?: PouchDB.Find.Selector): Promise<TrackedMediaItemDB[]> {
		const result = await this.db.find({
			selector: _.extend({
				sourceStorageId: storageId
			},
			query || {})
		})
		return result.docs
	}

	async remove(tmi: TrackedMediaItemDB): Promise<boolean> {
		let result = await this.db.remove(tmi._id, tmi._rev)
		return result.ok
	}

	async bulkChange(tmis: TrackedMediaItem[]): Promise<void> {
		await this.db.bulkDocs(tmis)
	}
}
