import * as _ from 'underscore'
import { EventEmitter } from 'events'
import { StorageHandler, File, FileProperties } from '../../storageHandlers/storageHandler'
import { LocalFolderStorage } from '../../api'

export class LocalFolderHandler extends EventEmitter implements StorageHandler {
	private _files: File[] = []

	constructor(_settings: LocalFolderStorage) {
		super()
	}

	init = jest.fn(
		(): Promise<void> => {
			return Promise.resolve()
		}
	)
	destroy = jest.fn(
		(): Promise<void> => {
			return Promise.resolve()
		}
	)

	getAllFiles = jest.fn(
		(): Promise<File[]> => {
			return Promise.resolve().then(() => this._files)
		}
	)
	_setAllFiles = (files: File[]): void => {
		this._files = files
	}

	getFile = jest.fn(
		(name: string): Promise<File> => {
			return Promise.resolve().then(() => {
				const obj = this._files.find((i) => i.name === name)
				if (!obj) throw new Error(`File "${name}" not found!`)
				return obj
			})
		}
	)
	_setFile = (name: string, obj: File): void => {
		const idx = this._files.findIndex((i) => i.name === name)
		if (idx < 0) {
			this._files.push(obj)
		} else {
			this._files[idx] = obj
		}
	}

	putFile = jest.fn(
		(file: File, _progressCallback?: (progress: number) => void): Promise<File> => {
			const newFile = _.clone(file)
			this._setFile(file.name, newFile)
			return Promise.resolve().then(() => newFile)
		}
	)

	deleteFile = jest.fn(
		(file: File): Promise<void> => {
			const idx = this._files.indexOf(file)
			if (idx < 0) throw new Error(`File "${file.name}" not found in storage`)
			return Promise.resolve()
		}
	)

	getFileProperties = jest.fn(
		(_file: File): Promise<FileProperties> => {
			return new Promise((resolve, _reject) => {
				resolve({
					created: Date.now(),
					modified: Date.now(),
					size: 1000
				})
			})
		}
	)
}
