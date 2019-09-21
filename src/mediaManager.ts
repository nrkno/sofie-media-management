import * as Winston from 'winston'
import * as _ from 'underscore'
import { PeripheralDeviceAPI as P } from 'tv-automation-server-core-integration'
import { extendMandadory } from './lib/lib'
import { CoreHandler, CoreConfig } from './coreHandler'
import { StorageSettings, DeviceSettings } from './api'
import { GeneralStorageSettings, StorageObject, buildStorageHandler } from './storageHandlers/storageHandler'
import { TrackedMediaItems } from './mediaItemTracker'
import { Dispatcher } from './work/dispatcher'
import { BaseWorkFlowGenerator } from './workflowGenerators/baseWorkFlowGenerator'
import { WatchFolderGenerator } from './workflowGenerators/watchFolderGenerator'
import { LocalStorageGenerator } from './workflowGenerators/localStorageGenerator'
import { ExpectedItemsGenerator } from './workflowGenerators/expectedItemsGenerator'
import { Process } from './process'
import { MonitorManager } from './monitors/manager'

export type SetProcessState = (processName: string, comments: string[], status: P.StatusCode) => void

const DEFAULT_WORKFLOW_LINGER_TIME = 24 * 60 * 60 * 1000
const DEFAULT_WORKERS = 3

export interface Config {
	process: ProcessConfig
	device: DeviceConfig
	core: CoreConfig
}
export interface ProcessConfig {
	/** Will cause the Node applocation to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
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
	private _process: Process

	private _monitorManager: MonitorManager = new MonitorManager()

	constructor(logger: Winston.LoggerInstance) {
		this._logger = logger
	}

	async init(config: Config): Promise<void> {
		this._config = config

		try {
			this._logger.info('Initializing Process...')
			this.initProcess()
			this._logger.info('Process initialized')

			this._logger.info('Initializing Core...')
			await this.initCore()
			this._logger.info('Core initialized')

			const peripheralDevice = await this.coreHandler.core.getPeripheralDevice()

			// Stop here if studioId not set
			if (!peripheralDevice.studioId) {
				this._logger.warn('------------------------------------------------------')
				this._logger.warn('Not setup yet, exiting process!')
				this._logger.warn('To setup, go into Core and add this device to a Studio')
				this._logger.warn('------------------------------------------------------')
				process.exit(1)
				return
			}
			this._logger.info('Initializing MediaManager...')

			await this.initMediaManager(peripheralDevice.settings || {})
			this._logger.info('MediaManager initialized')

			this._logger.info('Initialization done')
			return
		} catch (e) {
			this._logger.error('Error during initialization:')
			this._logger.error(e)
			this._logger.error(e.stack)
			try {
				if (this.coreHandler) {
					this.coreHandler.destroy().catch(this._logger.error)
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
	initProcess() {
		this._process = new Process(this._logger)
		this._process.init(this._config.process)
	}
	async initCore() {
		this.coreHandler = new CoreHandler(this._logger, this._config.device)
		return this.coreHandler.init(this._config.core, this._process)
	}

	async initMediaManager(settings: DeviceSettings): Promise<void> {
		// console.log(this.coreHandler.deviceSettings)
		this._logger.debug('Initializing Media Manager with the following settings:')
		this._logger.debug(JSON.stringify(settings))

		// TODO: Initialize Media Manager

		this._availableStorage = _.map(settings.storages || [], item => {
			return extendMandadory<StorageSettings, StorageObject>(item, {
				handler: buildStorageHandler(item as GeneralStorageSettings)
			})
		})

		this._trackedMedia = this._trackedMedia || new TrackedMediaItems()

		this._workFlowGenerators = []
		this._workFlowGenerators.push(
			new LocalStorageGenerator(this._availableStorage, this._trackedMedia, settings.mediaFlows || []),
			new WatchFolderGenerator(this._availableStorage, this._trackedMedia, settings.mediaFlows || []),
			new ExpectedItemsGenerator(
				this._availableStorage,
				this._trackedMedia,
				settings.mediaFlows || [],
				this.coreHandler,
				settings.lingerTime,
				settings.cronJobTime
			)
		)

		this._dispatcher = new Dispatcher(
			this._workFlowGenerators,
			this._availableStorage,
			this._trackedMedia,
			settings,
			settings.workers || DEFAULT_WORKERS,
			settings.workFlowLingerTime || DEFAULT_WORKFLOW_LINGER_TIME,
			this.coreHandler
		)

		this._dispatcher
			.on('error', this._logger.error)
			.on('warn', this._logger.warn)
			.on('info', this._logger.info)
			.on('debug', this._logger.debug)

		await Promise.all(
			this._availableStorage.map(st => {
				st.handler
					.init()
					.then(() => {
						this._logger.info(`Storage handler for "${st.id}" initialized.`)
					})
					.catch(reason => {
						this.coreHandler.setProcessState(
							st.id,
							[`Could not set up storage handler "${st.id}": ${reason}`],
							P.StatusCode.BAD
						)
						throw reason
					})
			})
		)
		await this._dispatcher.init()

		this._monitorManager.init(this.coreHandler)

		await this._monitorManager.onNewSettings(settings)

		// Monitor for changes in settings:
		this.coreHandler.onChanged(() => {
			this.coreHandler.core
				.getPeripheralDevice()
				.then(device => {
					if (device) {
						const settings = device.settings
						if (!_.isEqual(settings, this._monitorManager.settings)) {
							this._monitorManager.onNewSettings(settings).catch(e => this._logger.error(e))
						}
					}
				})
				.catch(() => {
					this._logger.error(`coreHandler.onChanged: Could not get peripheral device`)
				})
		})
	}
}
