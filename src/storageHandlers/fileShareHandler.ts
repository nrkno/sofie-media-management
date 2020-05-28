import * as _ from 'underscore'
import * as networkDrive from 'windows-network-drive'
import { LocalFolderHandler } from './localFolderHandler'
import { FileShareStorage, LocalFolderStorage, StorageType } from '../api'
import { LoggerInstance } from 'winston'

/**
 *  File Share handles a file share mapped as a network drive. If the drive is not
 *  mapped, the drive will be mapped automatically.
 */
export class FileShareHandler extends LocalFolderHandler {
	private _driveLetter: string
	private _uncPath: string
	private _username: string | undefined
	private _password: string | undefined

	private static convertSettings(fsSettings: FileShareStorage): LocalFolderStorage {
		if (!fsSettings.options.mappedNetworkedDriveTarget) {
			throw new Error(`File share handler: "${fsSettings.id}": mappedNetworkedDriveTarget not set!`)
		}
		if (!fsSettings.options.basePath) {
			throw new Error(`File share handler: "${fsSettings.id}": basePath not set!`)
		}
		const targetBasePath = fsSettings.options.mappedNetworkedDriveTarget + ':/'
		if (!targetBasePath.match(/[a-zA-Z]/)) {
			throw Error(`File share handler: mappedNetworkedDriveTarget needs to be a drive letter`)
		}
		const settingsObj: LocalFolderStorage = {
			id: fsSettings.id,
			support: fsSettings.support,
			type: StorageType.LOCAL_FOLDER,
			options: {
				basePath: targetBasePath,
				usePolling: true,
				onlySelectedFiles: // Needs to be false for standalone tests ... otherwise true
					typeof fsSettings.options.onlySelectedFiles === 'boolean' ? fsSettings.options.onlySelectedFiles : true
			}
		}
		return settingsObj
	}

	constructor(settings: FileShareStorage, protected logger: LoggerInstance) {
		super(FileShareHandler.convertSettings(settings), logger)
		this._uncPath = settings.options.basePath
		this._driveLetter = settings.options.mappedNetworkedDriveTarget
		this._username = settings.options.username
		this._password = settings.options.password
	}

	async init(): Promise<void> {
		let usedLetters: networkDrive.Dictionary<string> = {}
		// this.logger.debug(`File share details: ${JSON.stringify(this)}`)
		try {
			usedLetters = await networkDrive.list()
		} catch (e) {
			if (e.toString().match(/No Instance\(s\) Available/)) {
				// this error comes when the list is empty
				usedLetters = {}
			} else {
				throw e
			}
		}
		if (_.keys(usedLetters).indexOf(this._driveLetter) >= 0) {
			// Unmount that share:
			await networkDrive.unmount(this._driveLetter)
			// throw new Error(`Drive letter ${this._driveLetter} is already used for another share: "${usedLetters[this._driveLetter]}"`)
		}
		let mounts
		try {
			mounts = await networkDrive.find(this._uncPath)
		} catch (e) {
			mounts = []
		}
		if (mounts.indexOf(this._driveLetter.toUpperCase()) < 0) {
			await networkDrive.mount(this._uncPath, this._driveLetter, this._username, this._password)
		}
		this.logger.debug(`Finished mounting '${this._driveLetter}:' as '${this._uncPath}'`)
		return super.init()
	}

	parseUrl(url: string): string {
		if (url.startsWith(this._uncPath)) {
			return url.substr(this._uncPath.length).replace(/^\\/, '')
		}
		throw new Error(`This storage handler does not support file URL "${url}"`)
	}
}
