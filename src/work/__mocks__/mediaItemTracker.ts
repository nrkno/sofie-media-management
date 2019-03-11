import * as Winston from 'winston'
import { TrackedMediaItems as OriginalTrackedMediaItems } from '../../mediaItemTracker'
import * as PouchDB from 'pouchdb-node'
import * as PouchDBMemory from 'pouchdb-adapter-memory'

export class TrackedMediaItems extends OriginalTrackedMediaItems {
	constructor () {
		PouchDB.plugin(PouchDBMemory)
		super('memory')
	}
}
