import * as Winston from 'winston'
import { CoreHandler, CoreConfig } from './coreHandler'

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

	constructor (logger: Winston.LoggerInstance) {
		this._logger = logger
	}

	async init (config: Config): Promise<void> {
		this._config = config

		try {
			// await Promise.resolve();
			this._logger.info('Initializing Core...')
			await this.initCore()
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
		return Promise.resolve()

	}
}
