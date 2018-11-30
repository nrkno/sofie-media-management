import { StorageType, Time } from '../api'
import * as stream from 'stream'
import { EventEmitter } from 'events'

export interface File {
	name: string
	url: string
	source: StorageType

	getWritableStream (): Promise<stream.Writable>
	getReadableStream (): Promise<stream.Readable>
}

export interface FileProperties {
	size: number
	created: Time
	modified: Time
}

export enum StorageEventType {
	add = 'add',
	change = 'change',
	delete = 'delete'
}

export interface StorageEvent {
	type: StorageEventType,
	path: string
	file?: File
}

export interface StorageHandler extends EventEmitter {
	getAllFiles (): Promise<Array<File>>

	getFile (name: string): Promise<File>
	putFile (file: File): Promise<File>
	deleteFile (file: File): Promise<void>

	getFileProperties (file: File): Promise<FileProperties>

	init (): Promise<void>
	destroy (): Promise<void>
}
