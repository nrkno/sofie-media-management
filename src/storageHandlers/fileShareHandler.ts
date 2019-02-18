import * as _ from 'underscore'
import * as networkDrive from 'windows-network-drive'
import { LocalFolderHandler } from './localFolderHandler'
import { FileShareStorage, LocalFolderStorage, StorageType } from '../api'

/**
 * File Share handles a file share mapped as a network drive. If the drive is not mapped, the drive will be mapped automatically.
 */
export class FileShareHandler extends LocalFolderHandler {
	private _driveLetter: string
	private _uncPath: string
	private _username: string | undefined
	private _password: string | undefined

	constructor (settings: FileShareStorage) {
		if (!settings.options.mappedNetworkedDriveTarget) throw new Error(`"${settings.id}": mappedNetworkedDriveTarget not set!`)
		if (!settings.options.basePath) throw new Error(`"${settings.id}": basePath not set!`)
		const targetBasePath = settings.options.mappedNetworkedDriveTarget + ':\/'
		if (!targetBasePath.match(/[a-zA-Z]/)) throw Error('mappedNetworkedDriveTarget needs to be a drive letter')
		const settingsObj: LocalFolderStorage = {
			id: settings.id,
			support: settings.support,
			type: StorageType.LOCAL_FOLDER,
			options: {
				basePath: targetBasePath,
				usePolling: true,
				onlySelectedFiles: true // settings.options.onlySelectedFiles
			}
		}

		super(settingsObj)
		this._uncPath = settings.options.basePath
		this._driveLetter = settings.options.mappedNetworkedDriveTarget
		this._username = settings.options.username
		this._password = settings.options.password
	}

	async init (): Promise<void> {
		let mounts
		try {
			mounts = await networkDrive.find(this._uncPath)
		} catch (e) {
			mounts = []
		}
		const usedLetters = await networkDrive.list()
		if (_.keys(usedLetters).indexOf(this._driveLetter) >= 0) {
			throw new Error(`Drive letter ${this._driveLetter} is already used for another share: "${usedLetters[this._driveLetter]}"`)
		}
		if (mounts.indexOf(this._driveLetter.toUpperCase()) < 0) {
			await networkDrive.mount(this._uncPath, this._driveLetter, this._username, this._password)
		}
		return super.init()
	}

	parseUrl (url: string): string {
		if (url.startsWith(this._uncPath)) {
			return url.substr(this._uncPath.length).replace(/^\\/, '')
		}
		throw new Error(`This storage handler does not support file URL "${url}"`)
	}
}
