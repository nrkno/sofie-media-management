import * as networkDrive from 'windows-network-drive'
import * as fs from 'fs-extra'
import { FileShareHandler } from '../../storageHandlers/fileShareHandler'
import { StorageEventType, StorageEvent } from '../../storageHandlers/storageHandler'
import { StorageType } from '../../api'
import * as path from 'path'

jest.mock('windows-network-drive')

describe('FileShareHandler', () => {
	let fsh0: FileShareHandler

	beforeAll(async (done) => {
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
			await fsh0.init()
			fsh0.on('error', err => fail(err))
			done()
		} catch (e) {
			fail(e)
		}
	})

	it('mounts the network drive automatically', () => {
		expect(networkDrive.mount).toBeCalled()
	})
})
