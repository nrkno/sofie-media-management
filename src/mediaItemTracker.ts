import { Time, Duration } from './api'
import * as PouchDB from 'pouchdb-node'

export interface TrackedMediaItem {
	mediaId: string
	expectedMediaItemId: string
	storageId: string
	name: string
	lastSeen: Time
	lastTouch: Time
	lingerTime: Duration

	_id: string
}

export class TrackedMediaItems {
	private _db: PouchDB.Database

	constructor () {
		this._db = new PouchDB('trackedMediaItems')
		this._db.createIndex({ index: {
			fields: ['mediaId']
		}}).then(() => {
			// Index created
		}, () => console.log('Index could not be created.'))
		this._db.createIndex({ index: {
			fields: ['storageId', 'name']
		}}).then(() => {
			// Index created
		}, () => console.log('Index could not be created.'))
	}

	async put (tmi: TrackedMediaItem): Promise<PouchDB.Core.Response> {
		return this._db.put(tmi)
	}

	async get (tmi: TrackedMediaItem) {
		return this._db.get(tmi._id).then((value) => {
			return value as any as TrackedMediaItem
		})
	}
}
