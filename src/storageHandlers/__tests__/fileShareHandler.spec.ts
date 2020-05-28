import * as networkDrive from 'windows-network-drive'
import { FileShareHandler } from '../../storageHandlers/fileShareHandler'
import { StorageType } from '../../api'

jest.mock('windows-network-drive')

describe('FileShareHandler', () => {
	let fsh0: FileShareHandler

	beforeAll(async done => {
		fsh0 = new FileShareHandler({
			id: 'remote0',
			type: StorageType.FILE_SHARE,
			support: {
				read: true,
				write: false
			},
			options: {
				basePath: '\\\\STORAGE\\public',
				mappedNetworkedDriveTarget: 'U'
			}
		})
		try {
			fsh0.on('error', err => fail(err))
			await fsh0.init()
			done()
		} catch (e) {
			fail(e)
		}
	})

	it('mounts the network drive automatically', () => {
		expect(networkDrive.mount).toBeCalled()
	})
})
