import { GeneralStorageSettings, StorageHandler } from './storageHandler'
import { StorageType } from '../api'
import { LocalFolderHandler } from './localFolderHandler'
import { FileShareHandler } from './fileShareHandler'
import { QuantelHTTPHandler } from './quantelHttpHandler'

/**
 * A factory for storage handlers, based on the StorageSettings object
 * @export
 * @param  {StorageSettings} storage
 * @return StorageHandler
 */
export function buildStorageHandler(storage: GeneralStorageSettings): StorageHandler {
	switch (storage.type) {
		case StorageType.LOCAL_FOLDER:
			return new LocalFolderHandler(storage)
		case StorageType.FILE_SHARE:
			return new FileShareHandler(storage)
		case StorageType.QUANTEL_HTTP:
			return new QuantelHTTPHandler(storage)
	}
}
