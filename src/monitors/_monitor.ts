import { EventEmitter } from 'events'
import * as _ from 'underscore'
import * as crypto from 'crypto'
import { LoggerInstance } from 'winston'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { MonitorSettings, MediaObject, StorageSettings } from '../api'
import { MonitorDevice, CoreMonitorHandler } from '../coreHandler'
import { FetchError } from 'node-fetch'

export abstract class Monitor extends EventEmitter {
	public readonly deviceType: string
	protected coreHandler: CoreMonitorHandler

	private changes: PouchDB.Core.Changes<MediaObject>

	protected lastSequenceNr: number = 0

	private monitorConnectionTimeout: NodeJS.Timer | null = null

	private statusConnection: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}

	protected statusDisk: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}

	protected isDestroyed: boolean = false
	protected initialized: boolean = false

	// Accessor
	protected _status: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.BAD,
		messages: ['Initializing...']
	}

	constructor(
		readonly deviceId: string,
		protected db: PouchDB.Database<MediaObject>,
		readonly settings: MonitorSettings,
		protected logger: LoggerInstance,
		protected storageSettings?: StorageSettings
	) {
		super()
		this.deviceType = this.settings.type
	}

	setCoreHandler(coreHandler: CoreMonitorHandler) {
		this.coreHandler = coreHandler
	}

	public get status(): PeripheralDeviceAPI.StatusObject {
		return Object.assign(this._status)
	}

	abstract init(): Promise<void>

	async dispose(): Promise<void> {
		await this.coreHandler.dispose()
		this.isDestroyed = true
		if (this.changes) {
			this.changes.cancel()
		}
	}

	abstract get deviceInfo(): MonitorDevice

	/** Restart the monitoring, do a full re-sync  */
	abstract restart(): Promise<void>

	// Overide EventEmitter.on() for stronger typings:
	/** The connection status has changed */
	on(event: 'connectionChanged', listener: (status: PeripheralDeviceAPI.StatusObject) => void): this
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
		let sendDoc = _.omit(doc, ['_attachments']) // TODO not required with thumbs external
		this.logger.info('Media scanning: _sendChanged', JSON.stringify(sendDoc, null, 2))
		try {
			await this.coreHandler.core.callMethod(PeripheralDeviceAPI.methods.updateMediaObject, [
				this.settings.storageId,
				this.hashId(doc._id),
				sendDoc
			])
		} catch (e) {
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

	protected getChangesOptions() {
		return {
			since: this.lastSequenceNr || 'now',
			include_docs: true,
			live: true,
			attachments: true
		}
	}

	protected setConnectionStatus(connected: boolean) {
		let status = connected ? PeripheralDeviceAPI.StatusCode.GOOD : PeripheralDeviceAPI.StatusCode.BAD
		let messages = connected ? [] : ['MediaScanner not connected']
		if (status !== this.statusConnection.statusCode) {
			this.statusConnection.statusCode = status
			this.statusConnection.messages = messages
			this.updateAndSendStatus()
		}
	}

	protected updateStatus(): PeripheralDeviceAPI.StatusObject {
		let statusCode: PeripheralDeviceAPI.StatusCode = PeripheralDeviceAPI.StatusCode.GOOD
		let messages: Array<string> = []

		let statusSettings: PeripheralDeviceAPI.StatusObject = { statusCode: PeripheralDeviceAPI.StatusCode.GOOD }

		if (!this.settings.storageId || !this.storageSettings) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "storageId" not set or no corresponding storage']
			}
		} else if (!this.initialized) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Not initialized']
			}
		}

		_.each([statusSettings, this.statusConnection, this.statusDisk], s => {
			if (s.statusCode > statusCode) {
				messages = s.messages || []
				statusCode = s.statusCode
			} else if (s.statusCode === statusCode) {
				if (s.messages) {
					messages = messages.concat(s.messages)
				}
			}
		})
		return {
			statusCode,
			messages
		}
	}

	protected updateAndSendStatus() {
		const status = this.updateStatus()

		if (this.status.statusCode !== status.statusCode || !_.isEqual(this.status.messages, status.messages)) {
			this._status = {
				statusCode: status.statusCode,
				messages: status.messages
			}
			this.emit('connectionChanged', this.status)
		}
	}

	protected triggerMonitorConnection() {
		if (!this.monitorConnectionTimeout) {
			this.monitorConnectionTimeout = setTimeout(() => {
				this.monitorConnectionTimeout = null
				this.monitorConnection()
			}, 10 * 1000)
		}
	}

	protected monitorConnection() {
		if (this.isDestroyed) return

		if (this.statusConnection.statusCode === PeripheralDeviceAPI.StatusCode.BAD) {
			this.restartChangesStream(true)

			this.triggerMonitorConnection()
		}
	}

	protected restartChangesStream(rewindSequence?: boolean) {
		if (rewindSequence) {
			if (this.lastSequenceNr > 0) {
				this.lastSequenceNr--
			}
		}
		// restart the changes stream
		if (this.changes) {
			this.changes.cancel()
		}
		const opts = this.getChangesOptions()
		this.logger.info(`Media watcher: restarting changes stream (since ${opts.since})`)
		this.changes = this.db
			.changes<MediaObject>(opts)
			.on('change', changes => this.changeHandler(changes))
			.on('error', error => this.errorHandler(error))
	}

	protected changeHandler(changes: PouchDB.Core.ChangesResponseChange<MediaObject>) {
		const newSequenceNr: string | number = changes.seq
		if (_.isNumber(newSequenceNr)) this.lastSequenceNr = newSequenceNr
		else this.logger.warn(`Expected changes.seq to be number, got "${newSequenceNr}"`)

		if (changes.deleted) {
			if (!(changes.id + '').match(/watchdogIgnore/i)) {
				// Ignore watchdog file changes

				this.logger.debug('Media watcher: deleteMediaObject', changes.id, newSequenceNr)
				this.sendRemoved(changes.id).catch(e => {
					this.logger.error('Media watcher: error sending deleted doc', e)
				})
			}
		} else if (changes.doc) {
			const md: MediaObject = changes.doc
			if (!(md._id + '').match(/watchdogIgnore/i)) {
				// Ignore watchdog file changes

				this.logger.debug('Media watcher: updateMediaObject', newSequenceNr, md._id, md.mediaId)
				md.mediaId = md._id
				this.sendChanged(md).catch(e => {
					this.logger.error('Media watcher: error sending changed doc', e)
				})
			}
		}

		this.setConnectionStatus(true)

		this.triggerupdateFsStats()
	}

	protected errorHandler(err) {
		if (err instanceof SyntaxError || err instanceof FetchError || err.type === 'invalid-json') {
			this.logger.warn('Media watcher: terminated (' + err.message + ')') // not a connection issue
			this.restartChangesStream(true)
			return // restart silently, since PouchDB connections can drop from time to time and are not a very big issue
		} else {
			this.logger.error('Media watcher: Error', err)
		}

		this.setConnectionStatus(false)

		this.triggerMonitorConnection()
	}

	protected abstract triggerupdateFsStats(): void
}

export interface CoreObjRevisions {
	[objectId: string]: string
}
