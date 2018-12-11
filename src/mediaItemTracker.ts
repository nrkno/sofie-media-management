import { EventEmitter } from 'events'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as _ from 'underscore'
import * as Winston from 'winston'
import * as fs from 'fs-extra'
import { Time, Duration } from './api'

export interface TrackedMediaItemBase {
	_id: string

	expectedMediaItemId?: string

	sourceStorageId?: string
	targetStorageIds: string[]

	name: string
	lastSeen: Time
	lingerTime: Duration
}

export interface TrackedMediaItem extends TrackedMediaItemBase {
	_rev: string
}

export class TrackedMediaItems extends EventEmitter {
	private _db: PouchDB.Database<TrackedMediaItemBase>

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
		.then(() => {
			return this._db.createIndex({
				index: {
					fields: ['sourceStorageId']
				}
			})
		})
		.then(() => {
			// Index created
		}, () => this.emit('error', 'trackedMediaItems: Index "sourceStorageId" could not be created.'))
	}

	async put (tmi: TrackedMediaItemBase): Promise<string> {
		return this._db.put(tmi).then(value => value.id)
	}

	async getById (_id: string): Promise<TrackedMediaItem> {
		return this._db.get(_id).then((value) => {
			return value as any as TrackedMediaItem
		})
	}

	async getAllFromStorage (storageId: string, query?: PouchDB.Find.Selector) {
		return this._db.find({selector: _.extend({
			sourceStorageId: storageId
		}, query || {})}).then((value) => {
			return value.docs as TrackedMediaItem[]
		})
	}

	async remove (tmi: TrackedMediaItem): Promise<boolean> {
		return this._db.remove(tmi._id, tmi._rev).then((value) => value.ok)
	}
}
