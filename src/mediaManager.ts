import * as Winston from 'winston'
import * as _ from 'underscore'
import { extendMandadory } from './lib/lib'
import { CoreHandler, CoreConfig } from './coreHandler'
import { StorageSettings, StorageType, DeviceSettings, MediaFlowType } from './api'
import { StorageObject, buildStorageHandler } from './storageHandlers/storageHandler'
import { TrackedMediaItems } from './mediaItemTracker'
import { Dispatcher } from './work/dispatcher'
import { BaseWorkFlowGenerator } from './workflowGenerators/baseWorkFlowGenerator'
import { WatchFolderGenerator } from './workflowGenerators/watchFolderGenerator'
import { LocalStorageGenerator } from './workflowGenerators/localStorageGenerator'
import { ExpectedItemsGenerator } from './workflowGenerators/expectedItemsGenerator'

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
			this._logger.info('Initializing Core...')
			await this.initCore()
			this._logger.info('Skipping core initialization, just for now')
			this._logger.info('Core initialized')
			this._logger.info('Initializing MediaManager...')
			// const peripheralDevice = await this.coreHandler.core.getPeripheralDevice()
			// await this.initMediaManager(peripheralDevice.settings)
			await this.coreHandler.core.getPeripheralDevice()
			const settings = {
				mediaFlows: [
					{
						id: 'flow0',
						sourceId: 'local0',
						destinationId: 'local1',
						mediaFlowType: MediaFlowType.EXPECTED_ITEMS
					}
				],
				storages: [
					{
						id: 'local0',
						type: StorageType.LOCAL_FOLDER,
						support: {
							read: true,
							write: false
						},
						options: {
							basePath: './source'
						}
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
				],
				lingerTime: 3 * 24 * 60 * 60 * 1000,
				workers: 3
			}
			await this.initMediaManager(settings)

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
	async initCore () {
		this.coreHandler = new CoreHandler(this._logger, this._config.device)
		return this.coreHandler.init(this._config.core)
	}
	async initMediaManager (settings: DeviceSettings): Promise<void> {
		// console.log(this.coreHandler.deviceSettings)
		this._logger.debug(JSON.stringify(settings))

		// TODO: Initialize Media Manager

		this._availableStorage = _.map(settings.storages, (item) => {
			return extendMandadory<StorageSettings, StorageObject>(item, {
				handler: buildStorageHandler(item)
			})
		})

		this._trackedMedia = new TrackedMediaItems()

		this._workFlowGenerators = []
		this._workFlowGenerators.push(
			new LocalStorageGenerator(this._availableStorage, this._trackedMedia, settings.mediaFlows),
			new WatchFolderGenerator(this._availableStorage, this._trackedMedia, settings.mediaFlows),
			new ExpectedItemsGenerator(this._availableStorage, this._trackedMedia, settings.mediaFlows, this.coreHandler),
		)

		this._dispatcher = new Dispatcher(
			this._workFlowGenerators,
			this._availableStorage,
			this._trackedMedia,
			3)

		this._dispatcher.on('error', this._logger.error)
		.on('warn', this._logger.warn)
		.on('info', this._logger.info)
		.on('debug', this._logger.debug)

		await Promise.all(this._availableStorage.map((st) => st.handler.init()))
		await this._dispatcher.init()
	}
}
