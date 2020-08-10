import { GeneralStorageSettings, StorageHandler } from './storageHandler'
import { LoggerInstance } from 'winston'
import { StorageType } from '../api'
import { LocalFolderHandler } from './localFolderHandler'
import { QuantelHTTPHandler } from './quantelHttpHandler'
import { FileShareHandler } from './fileShareHandler'

/**
 * A factory for storage handlers, based on the StorageSettings object
 * @export
 * @param  {StorageSettings} storage
 * @return StorageHandler
 */
export function buildStorageHandler(storage: GeneralStorageSettings, logger: LoggerInstance): StorageHandler {
	switch (storage.type) {
		case StorageType.LOCAL_FOLDER:
			return new LocalFolderHandler(storage, logger)
		case StorageType.FILE_SHARE:
			return new FileShareHandler(storage, logger)
		case StorageType.QUANTEL_STREAM:
			throw new Error(
				'Not an actual storage handler. Storage type should not be instanciated as it has no file access.'
			)
		case StorageType.QUANTEL_HTTP:
			return new QuantelHTTPHandler(storage)
	}
}
