import { Monitor } from './_monitor'
import {
	DeviceSettings,
	MonitorSettings,
	MonitorSettingsType
} from '../api'
import * as _ from 'underscore'
import { MonitorMediaScanner } from './mediaScanner'
import { CoreMonitorHandler, CoreHandler } from '../coreHandler'
import { MonitorQuantel } from './quantel'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'

export class MonitorManager {

	private _monitors: {[id: string]: Monitor} = {}
	private _initialized: boolean = false
	private _coreHandler: CoreHandler

	public settings: DeviceSettings

	constructor () {}

	init (coreHandler) {
		this._coreHandler = coreHandler
		this._initialized = true
	}

	async onNewSettings (settings: DeviceSettings): Promise<boolean> {
		if (!this._initialized) throw new Error('MonitorManager not initialized')

		this.settings = settings

		let anythingChanged: boolean = false

		const monitors: {[id: string]: MonitorSettings} = settings.monitors || {}
		for (let monitorId in monitors) {
			const monitorSettings = monitors[monitorId]

			const existingMonitor: Monitor | undefined = this._monitors[monitorId]
			if (!existingMonitor) {
				await this.addMonitor(monitorId, monitorSettings)
				anythingChanged = true
			} else {
				if (!_.isEqual(
					existingMonitor.settings,
					monitorSettings
				)) {
					// The settings differ
					await this.removeMonitor(monitorId)
					await this.addMonitor(monitorId, monitorSettings)
					anythingChanged = true
				}
			}
		}
		for (let monitorId in this._monitors) {
			if (!monitors[monitorId]) {
				// the device has been removed
				await this.removeMonitor(monitorId)
				anythingChanged = true
			}
		}
		return anythingChanged
	}
	private async addMonitor (deviceId: string, settings: MonitorSettings): Promise<void> {

		if (settings.type === MonitorSettingsType.NULL) {
			// do nothing
			return
		}
		const monitor: Monitor | null = (
			settings.type === MonitorSettingsType.MEDIA_SCANNER ?
			new MonitorMediaScanner(deviceId, settings, this._coreHandler.logger) :
			settings.type === MonitorSettingsType.QUANTEL ?
			new MonitorQuantel(deviceId, settings, this._coreHandler.logger) :
			null
		)
		if (!monitor) throw new Error(`Monitor could not be created, type "${settings.type}" unknown`)

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
				messages: ['Error during init: ' + (e && e.message || e.stack || e.toString())]
			})
			this._coreHandler.logger.warn(e)
			coreMonitorHandler.dispose(true)
		}

	}
	private async removeMonitor (monitorId: string) {
		if (this._monitors[monitorId]) {

			await this._monitors[monitorId].dispose()

			delete this._monitors[monitorId]
		}
	}
}
