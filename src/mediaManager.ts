import * as Winston from 'winston'
import * as _ from 'underscore'
import { extendMandadory } from './lib/lib'
import { CoreHandler, CoreConfig } from './coreHandler'
import { StorageSettings, StorageType } from './api'
import { StorageObject, buildStorageHandler } from './storageHandlers/storageHandler'
import { TrackedMediaItems } from './mediaItemTracker'
import { Dispatcher } from './work/dispatcher'
import { BaseWorkFlowGenerator } from './workflowGenerators/baseWorkFlowGenerator'
import { WatchFolderGenerator } from './workflowGenerators/watchFolderGenerator'

export interface Config {
	device: DeviceConfig
	core: CoreConfig
}
export interface DeviceConfig {
	deviceId: string
	deviceToken: string
}
export class MediaManager {

	private coreHandler: CoreHandler
	private _config: Config
	private _logger: Winston.LoggerInstance

	private _availableStorage: StorageObject[]
	private _trackedMedia: TrackedMediaItems
	private _dispatcher: Dispatcher
	private _workFlowGenerators: BaseWorkFlowGenerator[]

	constructor (logger: Winston.LoggerInstance) {
		this._logger = logger
	}

	async init (config: Config): Promise<void> {
		this._config = config

		try {
			// await Promise.resolve();
			this._logger.info('Initializing Core...')
			// await this.initCore()
			this._logger.info('Skipping core initialization, just for now')
			this._logger.info('Core initialized')
			this._logger.info('Initializing MediaManager...')
			await this.initMediaManager()
			this._logger.info('MediaManager initialized')
			this._logger.info('Initialization done')
			return
		} catch (e) {
			this._logger.error('Error during initialization:')
			this._logger.error(e)
			this._logger.error(e.stack)
			try {
				if (this.coreHandler) {
					this.coreHandler.destroy()
						.catch(this._logger.error)
				}
			} catch (e1) {
				this._logger.error(e1)
			}
			this._logger.info('Shutting down in 10 seconds!')
			setTimeout(() => {
				process.exit(0)
			}, 10 * 1000)
			return
		}
	}
	initCore () {
		this.coreHandler = new CoreHandler(this._logger, this._config.device)
		return this.coreHandler.init(this._config.core)
	}
	initMediaManager (): Promise<void> {
		// TODO: Initialize Media Manager
		const storage: StorageSettings[] = [
			{
				id: 'local0',
				type: StorageType.LOCAL_FOLDER,
				support: {
					read: true,
					write: false
				},
				options: {
					basePath: './source'
				},
				watchFolder: true,
				watchFolderTargetId: 'local1'
			},
			{
				id: 'local1',
				type: StorageType.LOCAL_FOLDER,
				support: {
					read: true,
					write: true
				},
				options: {
					basePath: './target'
				}
			}
		]

		this._availableStorage = _.map(storage, (item) => {
			return extendMandadory<StorageSettings, StorageObject>(item, {
				handler: buildStorageHandler(item)
			})
		})

		this._trackedMedia = new TrackedMediaItems(this._logger)

		this._workFlowGenerators = []
		this._workFlowGenerators.push(
			new WatchFolderGenerator(this._logger, this._availableStorage, this._trackedMedia)
		)


		this._dispatcher = new Dispatcher(
			this._logger,
			this._workFlowGenerators,
			this._availableStorage,
			this._trackedMedia,
			3)

		return Promise.resolve()
			.then(() => Promise.all(this._availableStorage.map((st) => st.handler.init())))
			.then(() => this._dispatcher.init())
			.then(() => { })
	}
}
