import * as Winston from 'winston'
import { TrackedMediaItems as OriginalTrackedMediaItems } from '../../mediaItemTracker'

export class TrackedMediaItems extends OriginalTrackedMediaItems {
	constructor (logger: Winston.LoggerInstance) {
		super(logger, 'memory')
	}
}
