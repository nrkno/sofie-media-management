import { Monitor } from './_monitor'
import { DeviceSettings, MonitorSettings, MonitorSettingsType, MediaObject, StorageSettings } from '../api'
import * as _ from 'underscore'
import { MonitorMediaWatcher } from './mediaWatcher'
import { CoreMonitorHandler, CoreHandler } from '../coreHandler'
import { MonitorQuantel, isQuantelMonitor } from './quantel'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { Dispatcher } from '../work/dispatcher'
import { MediaManagerApp } from '../app'

// eslint-disable-rule no-mixed-spaces-and-tabs

export class MonitorManager {
	private _monitors: { [id: string]: Monitor } = {}
	private _initialized = false
	private _coreHandler: CoreHandler
	private _dispatcher: Dispatcher | undefined = undefined
	private _app: MediaManagerApp | undefined = undefined

	public settings: DeviceSettings

	constructor(private mediaDB: PouchDB.Database<MediaObject>) {}

	init(coreHandler: CoreHandler, dispatcher?: Dispatcher, app?: MediaManagerApp): void {
		this._coreHandler = coreHandler
		this._dispatcher = dispatcher
		this._app = app
		this._initialized = true
	}

	async onNewSettings(settings: DeviceSettings): Promise<boolean> {
		if (!this._initialized) throw new Error('MonitorManager not initialized')

		this.settings = settings

		let anythingChanged = false

		const monitors: { [id: string]: MonitorSettings } = settings.monitors || {}
		for (const monitorId in monitors) {
			const monitorSettings = monitors[monitorId]
			const storageSettings = this.settings.storages.find((x) => x.id === monitorSettings.storageId)

			const existingMonitor: Monitor | undefined = this._monitors[monitorId]
			if (!existingMonitor) {
				await this.addMonitor(monitorId, monitorSettings, storageSettings)
				anythingChanged = true
			} else {
				if (!_.isEqual(existingMonitor.settings, monitorSettings)) {
					// The settings differ
					await this.removeMonitor(monitorId)
					await this.addMonitor(monitorId, monitorSettings, storageSettings)
					anythingChanged = true
				}
			}
		}
		for (const monitorId in this._monitors) {
			if (!monitors[monitorId]) {
				// the device has been removed
				await this.removeMonitor(monitorId)
				anythingChanged = true
			}
			if (this._dispatcher) {
				const monitor = this._monitors[monitorId]
				if (isQuantelMonitor(monitor)) {
					this._dispatcher.setQuantelMonitor(monitor)
				}
			}
			if (this._app) {
				const monitor = this._monitors[monitorId]
				if (isQuantelMonitor(monitor)) {
					this._app.setQuantelMonitor(monitor)
				}
			}
		}
		return anythingChanged
	}
	private async addMonitor(
		deviceId: string,
		monitorSettings: MonitorSettings,
		storageSettings?: StorageSettings
	): Promise<void> {
		if (monitorSettings.type === MonitorSettingsType.NULL) {
			// do nothing
			return
		}
		const monitor: Monitor | null =
			monitorSettings.type === MonitorSettingsType.WATCHER
				? new MonitorMediaWatcher(
						deviceId,
						this.mediaDB,
						monitorSettings,
						this._coreHandler.logger,
						storageSettings
				  )
				: monitorSettings.type === MonitorSettingsType.QUANTEL
				? new MonitorQuantel(
						deviceId,
						this.mediaDB,
						monitorSettings,
						this._coreHandler.logger,
						(this._app && this._app.port) || undefined
				  )
				: null
		if (!monitor) throw new Error(`Monitor could not be created, type "${monitorSettings.type}" unknown`)

		// Setup Core connection and tie it to the Monitor:
		const coreMonitorHandler = new CoreMonitorHandler(this._coreHandler, monitor)
		monitor.on('connectionChanged', (deviceStatus) => {
			coreMonitorHandler.onConnectionChanged(deviceStatus)
		})
		await coreMonitorHandler.init()
		try {
			monitor.setCoreHandler(coreMonitorHandler)
			await monitor.init()
			this._monitors[deviceId] = monitor
		} catch (e) {
			await coreMonitorHandler.core.setStatus({
				statusCode: PeripheralDeviceAPI.StatusCode.FATAL,
				messages: ['Error during init: ' + ((e && e.message) || e.stack || e.toString())]
			})
			this._coreHandler.logger.warn(e)
			await coreMonitorHandler.dispose(true)
		}
	}

	private async removeMonitor(monitorId: string) {
		if (this._monitors[monitorId]) {
			await this._monitors[monitorId].dispose()

			delete this._monitors[monitorId]
		}
	}
}
