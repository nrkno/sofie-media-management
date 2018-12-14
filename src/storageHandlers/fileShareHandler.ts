import { LocalFolderHandler } from './localFolderHandler'
import { FileShareStorage, LocalFolderStorage, StorageType } from '../api'
import * as networkDrive from 'windows-network-drive'

/**
 * File Share handles a file share mapped as a network drive. If the drive is not mapped, the drive will be mapped automatically.
 */
export class FileShareHandler extends LocalFolderHandler {
	private _driveLetter: string
	private _uncPath: string
	private _username: string | undefined
	private _password: string | undefined

	constructor (settings: FileShareStorage) {
		const targetBasePath = settings.options.mappedNetworkedDriveTarget + '://'
		if (!targetBasePath.match(/[a-zA-Z]/)) throw Error('mappedNetworkedDriveTarget needs to be a drive letter')
		const settingsObj: LocalFolderStorage = {
			id: settings.id,
			support: settings.support,
			type: StorageType.LOCAL_FOLDER,
			options: {
				basePath: targetBasePath
			}
		}

		super(settingsObj)
		this._driveLetter = settings.options.mappedNetworkedDriveTarget
		this._username = settings.options.username
		this._password = settings.options.password
	}

	async init (): Promise<void> {
		const mounts = await networkDrive.find(this._uncPath)
		if (mounts.indexOf(this._driveLetter) < 0) {
			await networkDrive.mount(this._driveLetter, this._uncPath, this._username, this._password)
		}
		return super.init()
	}
}
