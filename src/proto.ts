/* tslint:disable:no-floating-promises */
import { LocalFolderHandler } from './storageHandlers/localFolderHandler'
import { StorageType } from './api'
import { StorageEventType } from './storageHandlers/storageHandler'

const h = new LocalFolderHandler({
	id: 'local0',
	type: StorageType.LOCAL_FOLDER,
	support: {
		read: true,
		write: true
	},
	options: {
		basePath: './test'
	}
})
h.init().then(() => {
	h.on(StorageEventType.change, a => console.log(a))
})
