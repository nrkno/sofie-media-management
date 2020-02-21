import { buildStorageHandler } from '../../storageHandlers/storageHandlerFactory'
import { StorageType, LocalFolderStorage, FileShareStorage } from '../../api'
import { literal } from '../../lib/lib'
import { LocalFolderHandler } from '../localFolderHandler'
import { FileShareHandler } from '../fileShareHandler'
import * as winston from 'winston'

describe('buildStorageHandler', () => {
	it('returns a new instance of a StorageHandler, based on the config', () => {
		const localHandler = buildStorageHandler(
			literal<LocalFolderStorage>({
				id: 'local0',
				type: StorageType.LOCAL_FOLDER,
				support: {
					read: false,
					write: false
				},
				options: {
					basePath: './'
				}
			}),
			new winston.Logger({ transports: [ new winston.transports.Console() ]})
		)

		expect(localHandler).toBeInstanceOf(LocalFolderHandler)

		const shareHandler = buildStorageHandler(
			literal<FileShareStorage>({
				id: 'share0',
				type: StorageType.FILE_SHARE,
				support: {
					read: false,
					write: false
				},
				options: {
					basePath: '\\\\SERVER\\share',
					mappedNetworkedDriveTarget: 'X'
				}
			}),
			new winston.Logger({ transports: [ new winston.transports.Console() ]})
		)

		expect(shareHandler).toBeInstanceOf(FileShareHandler)
	})
})
