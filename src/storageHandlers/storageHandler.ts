import { StorageType, Time, StorageSettings, LocalFolderStorage, FileShareStorage } from '../api'
import * as stream from 'stream'
import { EventEmitter } from 'events'
import { LocalFolderHandler } from './localFolderHandler'
import { FileShareHandler } from './fileShareHandler'

export interface StorageObject extends StorageSettings {
	handler: StorageHandler
}

export abstract class File {
	name: string
	url: string
	source: StorageType

	abstract getWritableStream (): Promise<stream.Writable>
	abstract getReadableStream (): Promise<stream.Readable>
	abstract getProperties (): Promise<FileProperties>
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

export abstract class StorageHandler extends EventEmitter {
	abstract getAllFiles (): Promise<Array<File>>

	abstract getFile (name: string): Promise<File>
	abstract putFile (file: File, progressCallback?: (progress: number) => void): Promise<File>
	abstract deleteFile (file: File): Promise<void>

	abstract getFileProperties (file: File): Promise<FileProperties>

	abstract init (): Promise<void>
	abstract destroy (): Promise<void>
}

export function buildStorageHandler (storage: StorageSettings): StorageHandler {
	switch (storage.type) {
		case StorageType.LOCAL_FOLDER:
			return new LocalFolderHandler(storage as any as LocalFolderStorage)
		case StorageType.FILE_SHARE:
			return new FileShareHandler(storage as any as FileShareStorage)
		default:
			throw new Error(`Could not build a storage handler for storage type: ${storage.type}`)
	}
}
