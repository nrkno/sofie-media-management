import { StorageType, Time, StorageSettings, LocalFolderStorage, FileShareStorage } from '../api'
import * as stream from 'stream'
import { EventEmitter } from 'events'
import { LocalFolderHandler } from './localFolderHandler'
import { FileShareHandler } from './fileShareHandler'

export type GeneralStorageSettings = LocalFolderStorage | FileShareStorage

export interface StorageObject extends StorageSettings {
	handler: StorageHandler
}

export abstract class File {
	/**
	 * The file name. Will contain path relative to storage root.
	 * @type string
	 * @memberof File
	 */
	name: string
	/**
	 * Storage-specific resource locator. Can be a fully-qualified URL or a file path.
	 * @type string
	 * @memberof File
	 */
	url: string
	/**
	 * Storage type of the file
	 * @type StorageType
	 * @memberof File
	 */
	source: StorageType

	/**
	 * Return a writable stream that can be written to, to fill the file with contents.
	 * @abstract
	 * @return Promise<stream.Writable>
	 * @memberof File
	 */
	abstract getWritableStream (): Promise<stream.Writable>
	/**
	 * Return a readable stream to read from the file
	 * @abstract
	 * @return Promise<stream.Readable>
	 * @memberof File
	 */
	abstract getReadableStream (): Promise<stream.Readable>
	/**
	 * Get the properties (created timestamp, modified timestamp and file size)
	 * @abstract
	 * @return Promise<FileProperties>
	 * @memberof File
	 */
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

/**
 * Handler for storage device/service
 */
export abstract class StorageHandler extends EventEmitter {

	on (type: StorageEventType.add | StorageEventType.change | StorageEventType.delete, listener: (e: StorageEvent) => void): this {
		return super.on(type, listener)
	}

	abstract parseUrl (url: string): string

	/**
	 * Get all file handles on the storage
	 * @abstract
	 * @returns An array of file handles in the storage
	 */
	abstract getAllFiles (): Promise<Array<File>>

	/**
	 * Get a file handle
	 * @abstract
	 * @param  name The file name (relative to the storage root)
	 * @returns Given file handle
	 */
	abstract getFile (name: string): Promise<File>
	/**
	 * Write a file to storage. If a file of the same name already exists, overwrite it.
	 * @abstract
	 * @param  file The file to be written to the storage
	 * @param  progressCallback? An optional callback to be called when the progress of the operation changes
	 * @returns The file created on the storage
	 */
	abstract putFile (file: File, progressCallback?: (progress: number) => void): Promise<File>
	/**
	 *
	 * @abstract Delete a file from storage
	 * @param  file The file to be deleted from this storage
	 * @return
	 */
	abstract deleteFile (file: File): Promise<void>

	/**
	 * Get file properties (file size, created timestamp and modified timestamp)
	 * @abstract
	 * @param  file The file to check the properties of
	 * @return Promise<FileProperties>
	 * @memberof StorageHandler
	 */
	abstract getFileProperties (file: File): Promise<FileProperties>

	/**
	 * Initialize the handler, set up the environment to be whatever it needs to be.
	 * @abstract
	 * @return
	 * @memberof StorageHandler
	 */
	abstract init (): Promise<void>

	/**
	 * Uninitialize the handler, stop sending events.
	 * @abstract
	 * @return
	 * @memberof StorageHandler
	 */
	abstract destroy (): Promise<void>
}

/**
 * A factory for storage handlers, based on the StorageSettings object
 * @export
 * @param  {StorageSettings} storage
 * @return StorageHandler
 */
export function buildStorageHandler (storage: GeneralStorageSettings): StorageHandler {
	switch (storage.type) {
		case StorageType.LOCAL_FOLDER:
			return new LocalFolderHandler(storage)
		case StorageType.FILE_SHARE:
			return new FileShareHandler(storage)
	}
}
