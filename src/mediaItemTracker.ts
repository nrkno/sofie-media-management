import { EventEmitter } from 'events'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBFind from 'pouchdb-find'
import * as _ from 'underscore'
import * as fs from 'fs-extra'
import { Time, Duration } from './api'
import { putToDBUpsert } from './lib/lib'

export interface TrackedMediaItem {
	_id: string

	expectedMediaItemId?: string[]

	sourceStorageId?: string
	targetStorageIds: string[]

	name: string
	comment?: string
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
		})
		.catch((e) => this.emit('error', 'trackedMediaItems: Index "sourceStorageId" could not be created.', e))
	}

	/**
	 * Find an item of a given ID, transform it using the delta function and store it in the DB
	 * If the item is not found (to be inserted), undefined will be sent to delta-function
	 * If undefined is returned from delta-function, no update will be made
	 */
	async upsert (id: string, delta: (tmi?: TrackedMediaItem) => TrackedMediaItem | undefined): Promise<TrackedMediaItem | undefined> {

		return putToDBUpsert(this._db, id, (original?: TrackedMediaItem): TrackedMediaItem | undefined => {

			const modified = delta(original)
			if (original && modified) {
				modified._id = original._id
				// @ts-ignore
				modified._rev = original._rev
			}

			return modified
		})
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
}
