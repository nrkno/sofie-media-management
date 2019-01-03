import { EventEmitter } from 'events'
import { StorageHandler, File, FileProperties, StorageEventType } from './storageHandler'
import { LocalFolderStorage, StorageType } from '../api'
import * as stream from 'stream'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as _ from 'underscore'
import * as chokidar from 'chokidar'

/**
 * A shared method to get the file properties from the underlying file system.
 * @param  {string} fileUrl
 * @return Promise<FileProperties>
 */
function getLocalFileProperties (fileUrl: string): Promise<FileProperties> {
	return new Promise((resolve, reject) => {
		fs.stat(fileUrl).then((stats) => {
			resolve({
				created: stats.ctimeMs,
				modified: stats.mtimeMs,
				size: stats.size
			})
		}, err => reject(err))
	})
}

export class LocalFolderFile implements File {
	source = StorageType.LOCAL_FOLDER
	private _name: string
	private _url: string
	private _read: boolean
	private _write: boolean

	constructor ()
	constructor (url: string, read: boolean, write: boolean, name?: string)
	constructor (url?: string, read?: boolean, write?: boolean, name?: string) {
		if (url) {
			this._url = url
			this._name = name || path.basename(url)
			this._read = !!read
			this._write = !!write
		}
	}

	get name (): string {
		return this._name
	}

	get url (): string {
		return this._url
	}

	async getWritableStream (): Promise<stream.Writable> {
		if (!this._write) throw Error(`File "${this._name}" is not writeable.`)
		return fs.createWriteStream(this._url)
	}

	async getReadableStream (): Promise<stream.Readable> {
		if (!this._read) throw Error(`File "${this._name}" is not readable.`)
		return fs.createReadStream(this._url)
	}

	async getProperties (): Promise<FileProperties> {
		return getLocalFileProperties(this._url)
	}
}

interface NestedFiles extends Array<Promise<File | NestedFiles | null>> {}

export class LocalFolderHandler extends EventEmitter implements StorageHandler {
	private _basePath: string
	private _watcher: chokidar.FSWatcher
	private _initialized: boolean = false
	private _writable: boolean = false
	private _readable: boolean = false

	constructor (settings: LocalFolderStorage) {
		super()

		this._writable = settings.support.write
		this._readable = settings.support.read

		this._basePath = settings.options.basePath
	}

	async init (): Promise<void> {
		this._watcher = chokidar.watch('.', {
			cwd: this._basePath,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 3000,
				pollInterval: 100
			},
			atomic: true,
			disableGlobbing: true,
			alwaysStat: true
		})
		.on('error', this.onError)
		.on('add', this.onAdd)
		.on('change', this.onChange)
		.on('unlink', this.onUnlink)

		return new Promise<void>((resolve) => {
			this._watcher.on('ready', () => {
				this._initialized = true
				resolve()
			})
		})
	}

	async destroy (): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			setTimeout(() => {
				if (this._initialized) {
					this._watcher.close()
					resolve()
					return
				}
				reject()
			})
		})
	}

	async getAllFiles (): Promise<File[]> {
		return _.compact(_.flatten(await this.traverseFolder(this._basePath)))
	}

	getFile (name: string): Promise<File> {
		if (!this._readable) throw Error('This storage is not readable.')
		return new Promise((resolve, reject) => {
			const localUrl = path.join(this._basePath, name)
			fs.stat(localUrl).then((stats) => {
				if (stats.isFile()) {
					resolve(new LocalFolderFile(localUrl, this._readable, this._writable, name))
				} else {
					reject('Object is not a file')
				}
			}, (err) => reject(err))
		})
	}

	putFile (file: File, progressCallback?: (progress: number) => void): Promise<File> {
		function progressMonitorFunc (localFile: File, sourceProperties: FileProperties): (() => void) {
			return (() => {
				localFile.getProperties().then((targetProperties) => {
					if (typeof progressCallback === 'function') {
						progressCallback(targetProperties.size / sourceProperties.size)
					}
				}, () => {
					// this is just to report progress on the file
				})
			})
		}

		if (!this._writable) throw Error('This storage is not writable.')
		if ((file.source === StorageType.LOCAL_FOLDER) || (file.source === StorageType.FILE_SHARE)) {
			// Use fast copy if possible
			return new Promise((resolve, reject) => {
				const localFile = this.createFile(file)
				file.getProperties().then((sourceProperties) => {
					fs.ensureDir(path.dirname(localFile.url)).then(() => {
						fs.access(file.url, async (exists) => {
							if (exists) {
								await fs.unlink(file.url)
							}

							const progressMonitor = setInterval(progressMonitorFunc(localFile, sourceProperties), 500)

							fs.copyFile(file.url, localFile.url, (err) => {
								clearInterval(progressMonitor)

								if (err) {
									reject(err)
									return
								}

								resolve()
							})
						})
					}, (err) => reject(err))
				}, (err) => reject(err))
			})
		} else {
			// Use streams if fast, system-level file system copy is not possible
			return new Promise((resolve, reject) => {
				file.getReadableStream().then((rStream) => {
					const localFile = this.createFile(file)
					file.getProperties().then((sourceProperties) => {
						fs.ensureDir(path.dirname(localFile.url)).then(() => {
							localFile.getWritableStream().then((wStream) => {
								const progressMonitor = setInterval(progressMonitorFunc(localFile, sourceProperties), 500)

								function handleError (e) {
									clearInterval(progressMonitor)
									reject(e)
								}

								rStream.on('end', () => {
									clearInterval(progressMonitor)
									resolve(localFile)
								})
								rStream.on('error', handleError)
								wStream.on('error', handleError)

								rStream.pipe(wStream)
							}, (reason) => {
								reject(reason)
							})
						}, err => reject(err))
					}, (e) => {
						throw new Error(`Could not get file properties for file: "${file.name}": ${e}`)
					})
				}, reason => reject(reason))
			})
		}
	}

	deleteFile (file: File): Promise<void> {
		if (!this._writable) throw Error('This storage is not writable.')
		return new Promise((resolve, reject) => {
			fs.unlink(file.url).then(() => resolve(), (err) => reject(err))
		})
	}

	getFileProperties (file: File): Promise<FileProperties> {
		return getLocalFileProperties(file.url)
	}

	/**
	 * Handles delete events from the File System watcher
	 * @private
	 * @memberof LocalFolderHandler
	 */
	private onUnlink = (filePath: string) => {
		this.emit(StorageEventType.delete, {
			type: StorageEventType.delete,
			path: filePath
		})
	}

	/**
	 * Handles change events from the File System watcher
	 * @private
	 * @memberof LocalFolderHandler
	 */
	private onChange = (filePath: string) => {
		this.emit(StorageEventType.change, {
			type: StorageEventType.change,
			path: filePath,
			file: new LocalFolderFile(path.join(this._basePath, filePath), this._readable, this._writable, filePath)
		})
	}

	/**
	 * Handles add events from the File System watcher
	 * @private
	 * @memberof LocalFolderHandler
	 */
	private onAdd = (filePath: string) => {
		this.emit(StorageEventType.add, {
			type: StorageEventType.add,
			path: filePath,
			file: new LocalFolderFile(path.join(this._basePath, filePath), this._readable, this._writable, filePath)
		})
	}

	/**
	 * Handles errors from the file system watcher
	 * @private
	 * @memberof LocalFolderHandler
	 */
	private onError = (e: any) => {
		process.stderr.write(e)
	}

	/**
	 * Creates a file in the storage, based on an existing file from another storage
	 * @private
	 * @param  {File} sourceFile
	 * @return LocalFolderFile
	 * @memberof LocalFolderHandler
	 */
	private createFile (sourceFile: File): LocalFolderFile {
		const newFile = new LocalFolderFile(path.join(this._basePath, sourceFile.name), this._readable, this._writable, sourceFile.name)
		return newFile
	}

	/**
	 * Gathers all the file in a folder recursively
	 * @private
	 * @param  {string} folder
	 * @param  {string} [accumulatedPath]
	 * @return Promise<NestedFiles>
	 * @memberof LocalFolderHandler
	 */
	private traverseFolder (folder: string, accumulatedPath?: string): Promise<NestedFiles> {
		return new Promise((resolve, reject) => {
			fs.readdir(folder).then((files) => {
				const result: NestedFiles = files.map((entry) => {
					const entryUrl = path.join(folder, entry)
					return new Promise((resolve, reject) => {
						fs.stat(entryUrl).then((stats) => {
							if (stats.isFile()) {
								resolve(new LocalFolderFile(entryUrl, this._readable, this._writable, path.join(accumulatedPath || '', entry)))
							} else if (stats.isDirectory()) {
								resolve(this.traverseFolder(entryUrl, path.join(accumulatedPath || '', entry)))
							} else {
								resolve(null)
							}
						}, err => reject(err))
					})
				})
				Promise.all(result).then((resolved) => {
					resolve(_.flatten(resolved))
				}).catch(reason => reject(reason))
			}, err => reject(err))
		})
	}
}
