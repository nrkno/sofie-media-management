import { EventEmitter } from 'events'
import * as _ from 'underscore'
import * as crypto from 'crypto'
import { LoggerInstance } from 'winston'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { MonitorSettings, MediaObject } from '../api'
import {
	MonitorDevice,
	CoreMonitorHandler
} from '../coreHandler'

export abstract class Monitor extends EventEmitter {
	public deviceType: string
	protected _coreHandler: CoreMonitorHandler

	protected _status: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.BAD,
		messages: ['Initializing...']
	}
	constructor (
		private _deviceId: string,
		protected _settings: MonitorSettings,
		protected logger: LoggerInstance
	) {
		super()
		this.deviceType = this._settings.type
	}

	setCoreHandler (coreHandler: CoreMonitorHandler) {
		this._coreHandler = coreHandler
	}
	abstract init (): Promise<void>
	async dispose (): Promise<void> {
		this._coreHandler.dispose()
	}
	abstract get deviceInfo (): MonitorDevice

	public get settings () {
		return this._settings
	}
	public get deviceId () {
		return this._deviceId
	}
	public get status (): PeripheralDeviceAPI.StatusObject {
		return this._status
	}
	/** Restart the monitoring, do a full re-sync  */
	abstract restart (): Promise<void>

	// Overide EventEmitter.on() for stronger typings:
	/** The connection status has changed */
	on (event: 'connectionChanged', listener: (status: PeripheralDeviceAPI.StatusObject) => void): this
	on (event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener)
	}
	// Overide EventEmitter.emit() for stronger typings:
	emit (event: 'connectionChanged', status: PeripheralDeviceAPI.StatusObject): boolean
	emit (event: string, ...args: any[]): boolean {
		return super.emit(event, ...args)
	}
	/** To be triggered whenever a MediaObject is added or changed */
	protected async _sendChanged (doc: MediaObject): Promise<void> {
		try {

			let sendDoc = _.omit(doc, ['_attachments'])
			sendDoc.mediaId = doc._id
			// @ts-ignore
			// this.logger.info('MediaScanner: _sendChanged', JSON.stringify(sendDoc, ' ', 2))
			await this._coreHandler.core.callMethodLowPrio(PeripheralDeviceAPI.methods.updateMediaObject, [
				this._settings.storageId,
				this.hashId(doc._id),
				sendDoc
			])
		} catch (e) {
			// @ts-ignore
			this.logger.info('MediaScanner: _sendChanged', JSON.stringify(sendDoc, ' ', 2))
			this.logger.error('MediaScanner: Error while updating changed Media object', e)
		}
	}
	/** To be triggered whenever a MediaObject is removed */
	protected async _sendRemoved (docId: string): Promise<void> {
		try {
			await this._coreHandler.core.callMethodLowPrio(PeripheralDeviceAPI.methods.updateMediaObject, [
				this._settings.storageId,
				this.hashId(docId),
				null
			])
		} catch (e) {
			this.logger.error('MediaScanner: Error while updating deleted Media object', e)
		}
	}
	protected hashId (id: string): string {
		return crypto.createHash('md5').update(id).digest('hex')
	}
	protected async getAllCoreObjRevisions (): Promise<CoreObjRevisions> {
		const coreObjects = await this._coreHandler.core.callMethodLowPrio(PeripheralDeviceAPI.methods.getMediaObjectRevisions, [
			this._settings.storageId
		])

		let coreObjRevisions: CoreObjRevisions = {}
		_.each(coreObjects, (obj: any) => {
			coreObjRevisions[obj.id] = obj.rev
		})
		return coreObjRevisions
	}
}
export interface CoreObjRevisions {
	[objectId: string]: string
}
