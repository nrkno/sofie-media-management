import { EventEmitter } from 'events'
import { StorageHandler, File, FileProperties, StorageEventType } from './storageHandler'
import { LocalFolderStorage, StorageType } from '../api'
import * as stream from 'stream'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as _ from 'underscore'
import * as chokidar from 'chokidar'

export class LocalFolderFile implements File {
	source = StorageType.LOCAL_FOLDER
	private _name: string
	private _url: string
	private _read: boolean
	private _write: boolean

	constructor (url: string, read: boolean, write: boolean, name?: string) {
		this._url = url
		this._name = name || path.basename(url)
		this._read = !!read
		this._write = !!write
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
				stabilityThreshold: 2000,
				pollInterval: 1000
			},
			atomic: true
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

	putFile (file: File): Promise<File> {
		if (!this._writable) throw Error('This storage is not writable.')
		if ((file.source === StorageType.LOCAL_FOLDER) || (file.source === StorageType.FILE_SHARE)) {
			// Use fast copy if possible
			return new Promise((resolve, reject) => {
				const localFile = this.createFile(file)
				fs.ensureDir(path.dirname(localFile.url)).then(() => {
					fs.exists(file.url, async (exists) => {
						if (exists) {
							await fs.unlink(file.url)
						}

						fs.copyFile(file.url, localFile.url, (err) => {
							if (err) {
								reject(err)
								return
							}

							resolve()
						})
					})
				}, (err) => reject(err))
			})
		} else {
			// Use streams if fast, system-level file system copy is not possible
			return new Promise((resolve, reject) => {
				file.getReadableStream().then((rStream) => {
					const localFile = this.createFile(file)
					fs.ensureDir(path.dirname(localFile.url)).then(() => {
						localFile.getWritableStream().then((wStream) => {
							rStream.on('end', () => {
								resolve(localFile)
							})
							rStream.on('error', reject)
							wStream.on('error', reject)

							rStream.pipe(wStream)
						}, (reason) => {
							reject(reason)
						})
					}, err => reject(err))
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
		return new Promise((resolve, reject) => {
			fs.stat(file.url).then((stats) => {
				resolve({
					created: stats.ctimeMs,
					modified: stats.mtimeMs,
					size: stats.size
				})
			}, err => reject(err))
		})
	}

	private onUnlink = (filePath: string) => {
		this.emit(StorageEventType.delete, {
			type: StorageEventType.delete,
			path: filePath
		})
	}

	private onChange = (filePath: string) => {
		this.emit(StorageEventType.change, {
			type: StorageEventType.change,
			path: filePath,
			file: new LocalFolderFile(path.join(this._basePath, filePath), this._readable, this._writable, filePath)
		})
	}

	private onAdd = (filePath: string) => {
		this.emit(StorageEventType.add, {
			type: StorageEventType.add,
			path: filePath,
			file: new LocalFolderFile(path.join(this._basePath, filePath), this._readable, this._writable, filePath)
		})
	}

	private onError = (e: any) => {
		process.stderr.write(e)
	}

	private createFile (sourceFile: File): LocalFolderFile {
		const newFile = new LocalFolderFile(path.join(this._basePath, sourceFile.name), this._readable, this._writable, sourceFile.name)
		return newFile
	}

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
