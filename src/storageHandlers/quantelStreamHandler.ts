import { StorageHandler, File, FileProperties } from './storageHandler'
import { StorageType } from '../api'
import * as stream from 'stream'
import { literal } from '../lib/lib'
import { CancelablePromise } from '../lib/cancelablePromise'

// Fake file that is a simple handle to allow streaming access to Quantel-stored clips
export class QuantelStream implements File {
	public readonly source = StorageType.QUANTEL_STREAM
	constructor(
		public readonly name: string, 
		public readonly url: string,
		public readonly read: true
	) { } 

	getWritableStream (): Promise<stream.Writable> {
		throw new Error('getWriteableStream: not implemented for Quantel items')
	}
	getReadableStream (): Promise<stream.Readable> {
		throw new Error('getReadableStream: not implemented for Quantel items')
	}
	getProperties (): Promise<FileProperties> {
		return Promise.resolve(
			literal<FileProperties>({ size: undefined, created: undefined, modified: undefined })
		)
	}
}

export class QuantelStreamHandlerSingleton extends StorageHandler {
	private static instance = new QuantelStreamHandlerSingleton()
	static get Instance() {
		return this.instance
	}
	constructor() {
		super()
	}
	parseUrl = (_url: string): string => {
		throw new Error(`parseUrl: Not implemented for Quantel`)
	}
	getAllFiles = (): Promise<Array<File>> => {
		throw new Error(`getAllFiles: Not implemetned for Quantel`)
	}
	addMonitoredFile = (_url: string): void => {
		throw new Error(`addMonitoredFile: Not implemented for Quantel`)
	}
	removeMonitoredFile = (_url: string): void => {
		throw new Error(`removeMonitoredFile: Not implemented for Quantel`)
	}
	getFile = (_name: string): Promise<File> => {
		throw new Error(`getFile: Not implemented for Quantel`)
	}
	putFile = (_file: File, _progressCallback?: (progress: number) => void): CancelablePromise<File> => {
		throw new Error(`putFile: Not implemented for Quantel`)
	}
	deleteFile = (_file: File): Promise<void> => {
		throw new Error(`deleteFile: Not implemetned for Quantel`)
	}
	getFileProperties = (_file: File): Promise<FileProperties> => {
		throw new Error(`getFileProperties: Not implemented for Quantel`)
	}
	init = (): Promise<void> => {
		throw new Error(`init: Not implemented for Quantel`)
	}
	destroy = (): Promise<void> => {
		throw new Error(`destroy: Not implemented for Quantel`)
	}
}