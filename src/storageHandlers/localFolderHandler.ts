import { EventEmitter } from 'events'
import { StorageHandler, File, FileProperties } from './storageHandler'
import { LocalFolderStorage, StorageType } from '../api'
import * as stream from 'stream'
import * as fs from 'fs'
import * as path from 'path'
import * as _ from 'underscore'

export class LocalFolderFile implements File {
	source = StorageType.LOCAL_FOLDER
	private _name: string
	private _url: string

	constructor (url: string, name?: string) {
		this._url = url
		this._name = name || path.basename(url)
	}

	get name (): string {
		return this._name
	}

	get url (): string {
		return this._url
	}

	async getWritableStream (): Promise<stream.Writable> {
		return fs.createWriteStream(this._url)
	}

	async getReadableStream (): Promise<stream.Readable> {
		return fs.createReadStream(this._url)
	}
}

interface NestedFiles extends Array<Promise<File | NestedFiles | null>> {}

export class LocalFolderHandler extends EventEmitter implements StorageHandler {
	private _basePath: string

	constructor (settings: LocalFolderStorage) {
		super()

		this._basePath = settings.options.basePath
	}

	async getAllFiles (): Promise<File[]> {
		return _.compact(_.flatten(await this.traverseFolder(this._basePath)))
	}

	getFile (name: string): Promise<File> {
		return new Promise((resolve, reject) => {
			const localUrl = path.join(this._basePath, name)
			fs.stat(localUrl, (err, stats) => {
				if (err) {
					reject(err)
					return
				}

				if (stats.isFile()) {
					resolve(new LocalFolderFile(localUrl, name))
				} else {
					reject('Object is not a file')
				}
			})
		})
	}

	putFile (file: File): Promise<File> {
		if ((file.source === StorageType.LOCAL_FOLDER) || (file.source === StorageType.FILE_SHARE)) {
			// Use fast copy if possible
			return new Promise((resolve, reject) => {
				const localFile = this.createFile(file)
				fs.copyFile(file.url, localFile.url, (err) => {
					if (err) {
						reject(err)
						return
					}

					resolve()
				})
			})
		} else {
			// Use streams if fast, system-level file system copy is not possible
			return new Promise((resolve, reject) => {
				file.getReadableStream().then((rStream) => {
					const localFile = this.createFile(file)
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
				}, (reason) => {
					reject(reason)
				})
			})
		}
	}

	dropFile (file: File): Promise<void> {
		return new Promise((resolve, reject) => {
			fs.unlink(file.url, (err) => {
				if (err) {
					reject(err)
					return
				}

				resolve()
			})
		})
	}

	getFileProperties (file: File): Promise<FileProperties> {
		return new Promise((resolve, reject) => {
			fs.stat(file.url, (err, stats) => {
				if (err) {
					reject(err)
					return
				}

				resolve({
					created: stats.ctimeMs,
					modified: stats.mtimeMs,
					size: stats.size
				})
			})
		})
	}

	private createFile (sourceFile: File): LocalFolderFile {
		const newFile = new LocalFolderFile(path.join(this._basePath, sourceFile.name), sourceFile.name)
		return newFile
	}

	private traverseFolder (folder: string, accumulatedPath?: string): Promise<NestedFiles> {
		return new Promise((resolve, reject) => {
			fs.readdir(folder, (err, files) => {
				if (err) {
					reject(err)
					return
				}

				const result: NestedFiles = files.map((entry) => {
					const entryUrl = path.join(folder, entry)
					return new Promise((resolve, reject) => {
						fs.stat(entryUrl, (err, stats) => {
							if (err) {
								reject(err)
								return
							}

							if (stats.isFile()) {
								resolve(new LocalFolderFile(entryUrl, path.join(accumulatedPath || '', entry)))
							} else if (stats.isDirectory()) {
								resolve(this.traverseFolder(entryUrl, path.join(accumulatedPath || '', entry)))
							} else {
								resolve(null)
							}
						})
					})
				})
				Promise.all(result).then((resolved) => {
					resolve(_.flatten(resolved))
				}).catch(reason => reject(reason))
			})
		})
	}
}
