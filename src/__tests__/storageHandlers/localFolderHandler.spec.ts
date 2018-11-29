import { LocalFolderHandler } from '../../storageHandlers/localFolderHandler'
import { StorageType } from '../../api'

describe('LocalFolderHandler', () => {
	let lfh0: LocalFolderHandler
	beforeAll(() => {
		lfh0 = new LocalFolderHandler({
			id: 'local0',
			support: {
				read: true,
				write: true
			},
			type: StorageType.LOCAL_FOLDER,
			options: {
				basePath: '.'
			}
		})
	})
	test('check local', () => {
		lfh0.getAllFiles().then((files) => {
			expect(files.length).toBeGreaterThan(0)
		}, reason => fail(reason))
	})
})
