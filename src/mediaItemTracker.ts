import { EventEmitter } from 'events'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as _ from 'underscore'
import * as fs from 'fs-extra'
import { Time, Duration } from './api'

export interface TrackedMediaItem {
	_id: string

	expectedMediaItemId?: string[]

	sourceStorageId?: string
	targetStorageIds: string[]

	name: string
	lastSeen: Time
	lingerTime: Duration
}

export interface TrackedMediaItemDB extends TrackedMediaItem {
	_rev: string
}

export class TrackedMediaItems extends EventEmitter {
	private _db: PouchDB.Database<TrackedMediaItem>

	constructor (dbAdapter?: string, dbPrefix?: string) {
		super()

		PouchDB.plugin(PouchDBFind)

		fs.ensureDirSync(dbPrefix || './db')
		const PrefixedPouchDB = PouchDB.defaults({
			prefix: dbPrefix || './db/'
		} as any)

		this._db = new PrefixedPouchDB('trackedMediaItems', {
			adapter: dbAdapter
		})
		this._db.compact()
		.then(() => this._db.createIndex({
			index: {
				fields: ['sourceStorageId']
			}
		})).then(() => this._db.createIndex({
			index: {
				fields: ['mediaFlowId']
			}
		}))
		.then(() => {
			// Index created
		}, () => this.emit('error', 'trackedMediaItems: Index "sourceStorageId" could not be created.'))
	}

	async upsert (id: string, delta: (tmi: TrackedMediaItem) => TrackedMediaItem): Promise<string> {
		const original = await this._db.get(id)
		const modified = delta(original)
		return this.tryAndPut(id, modified, delta)
	}

	async put (tmi: TrackedMediaItem): Promise<string> {
		return this._db.put(tmi).then(value => value.id)
	}

	async getById (_id: string): Promise<TrackedMediaItemDB> {
		return this._db.get(_id).then((value) => {
			return value as TrackedMediaItemDB
		})
	}

	async getAllFromStorage (storageId: string, query?: PouchDB.Find.Selector) {
		return this._db.find({selector: _.extend({
			sourceStorageId: storageId
		}, query || {})}).then((value) => {
			return value.docs as TrackedMediaItemDB[]
		})
	}

	async remove (tmi: TrackedMediaItemDB): Promise<boolean> {
		return this._db.remove(tmi._id, tmi._rev).then((value) => value.ok)
	}

	async bulkChange (tmis: TrackedMediaItem[]): Promise<void> {
		return this._db.bulkDocs(tmis).then(({}) => { })
	}

	private async tryAndPut (id: string, doc: TrackedMediaItem, delta: (tmi: TrackedMediaItem) => TrackedMediaItem): Promise<string> {
		try {
			await this._db.put(doc)
			return id
		} catch (e0) {
			const e = e0 as PouchDB.Core.Error
			if (e.status !== 409) {
				throw e0
			}
			return (new Promise(resolve => setTimeout(resolve, 100 * Math.random()))).then(() => this.upsert(id, delta))
		}
	}

}
