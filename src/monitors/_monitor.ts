import { EventEmitter } from 'events'
import * as _ from 'underscore'
import * as crypto from 'crypto'
import { LoggerInstance } from 'winston'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { MonitorSettings, MediaObject } from '../api'
import { MonitorDevice, CoreMonitorHandler } from '../coreHandler'

export abstract class Monitor extends EventEmitter {
	public readonly deviceType: string
	protected coreHandler: CoreMonitorHandler

	protected status: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.BAD,
		messages: ['Initializing...']
	}

	constructor(
		readonly deviceId: string,
		readonly settings: MonitorSettings,
		protected logger: LoggerInstance
	) {
		super()
		this.deviceType = this.settings.type
	}

	setCoreHandler(coreHandler: CoreMonitorHandler) {
		this.coreHandler = coreHandler
	}

	public getStatus(): PeripheralDeviceAPI.StatusObject {
		return Object.assign(this.status)
	}

	abstract init(): Promise<void>

	async dispose(): Promise<void> {
		await this.coreHandler.dispose()
	}

	abstract get deviceInfo(): MonitorDevice

	/** Restart the monitoring, do a full re-sync  */
	abstract restart(): Promise<void>

	// Overide EventEmitter.on() for stronger typings:
	/** The connection status has changed */
	on(event: 'connectionChanged',
		listener: (status: PeripheralDeviceAPI.StatusObject) => void): this
	on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener)
	}

	// Overide EventEmitter.emit() for stronger typings:
	emit(event: 'connectionChanged', status: PeripheralDeviceAPI.StatusObject): boolean
	emit(event: string, ...args: any[]): boolean {
		return super.emit(event, ...args)
	}

	/** To be triggered whenever a MediaObject is added or changed */
	protected async sendChanged(doc: MediaObject): Promise<void> {
		try {
			let sendDoc = _.omit(doc, ['_attachments'])
			// @ts-ignore
			// this.logger.info('MediaScanner: _sendChanged', JSON.stringify(sendDoc, ' ', 2))
			await this._coreHandler.core.callMethod(PeripheralDeviceAPI.methods.updateMediaObject, [
				this.settings.storageId,
				this.hashId(doc._id),
				sendDoc
			])
		} catch (e) {
			// @ts-ignore
			this.logger.info('Media scanning: _sendChanged', JSON.stringify(sendDoc, ' ', 2))
			this.logger.error('Media scanning: error while updating changed Media object', e)
		}
	}

	/** To be triggered whenever a MediaObject is removed */
	protected async sendRemoved(docId: string): Promise<void> {
		try {
			await this.coreHandler.core.callMethod(PeripheralDeviceAPI.methods.updateMediaObject, [
				this.settings.storageId,
				this.hashId(docId),
				null
			])
		} catch (e) {
			this.logger.error('Media scanning: error while updating deleted Media object', e)
		}
	}

	protected hashId(id: string): string {
		return crypto
			.createHash('md5')
			.update(id)
			.digest('hex')
	}

	protected async getAllCoreObjRevisions(): Promise<CoreObjRevisions> {
		const coreObjects = await this.coreHandler.core.callMethodLowPrio(
			PeripheralDeviceAPI.methods.getMediaObjectRevisions,
			[this.settings.storageId]
		)

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
