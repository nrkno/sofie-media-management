import * as _ from 'underscore'
import * as url from 'url'
import {
	PeripheralDeviceAPI,
	Collection,
	Observer
} from 'tv-automation-server-core-integration'
import { Monitor } from './_monitor'
import { MonitorDevice } from '../coreHandler'
import { LoggerInstance } from 'winston'
import { MonitorSettingsQuantel, ExpectedMediaItem } from '../api'
import { QuantelGateway } from './lib/quantelGateway'
import { MediaObject } from '../api/mediaObject'
import { getHash } from '../lib/lib';

/** The minimum time to wait between polling status */
const BREATHING_ROOM = 300

/** Minimum time files that are already existing */
const CHECK_TIME_READY = 60 * 1000
/** Minimum time between checks of missing files  */
const CHECK_TIME_OTHER = 2 * 1000

type QuantelClipSearchQuery = {
	ClipGUID?: string,
	Title?: string
}
const QUANTEL_URL_PROTOCOL = 'quantel:'

export class MonitorQuantel extends Monitor {

	logger: LoggerInstance
	protected _settings: MonitorSettingsQuantel

	private expectedMediaItems: Collection
	private observer: Observer
	private _expectedMediaItemsSubscription: string

	private monitoredFiles: QuantelMonitor = {}
	private _studioId: string
	private _quantel: QuantelGateway
	private _isDestroyed: boolean = false
	private _watchError: string | null
	private _cachedMediaObjects: {[objectId: string]: (MediaObject | { _id: string,_rev: string})} = {}

	constructor (deviceId: string, _settings: MonitorSettingsQuantel, logger: LoggerInstance) {
		super(deviceId, _settings, logger)

		this._quantel = new QuantelGateway()
		this._quantel.on('error', e => this.logger.error('Quantel.QuantelGateway', e))
	}

	get deviceInfo (): MonitorDevice {
		// @ts-ignore: todo: make stronger typed, via core-integration
		return {
			deviceName: `Quantel (${this._settings.gatewayUrl} ${this._quantel.zoneId}/${this._quantel.serverId})`,
			deviceId: this.deviceId,

			deviceCategory: PeripheralDeviceAPI.DeviceCategory.MEDIA_MANAGER,
			deviceType: PeripheralDeviceAPI.DeviceType.MEDIA_MANAGER,

			// @ts-ignore: todo: make stronger typed, via core-integration
			deviceSubType: 'quantel'
		}
	}
	public async restart (): Promise<void> {
		throw Error('Quantel restart not implemented yet')
	}
	public async init (): Promise<void> {

		this.logger.info(`Initializing Quantel-monitor`, this._settings)

		const device = await this._coreHandler.getParentDevice()

		this._studioId = device.studioId

		if (!this._studioId) throw new Error('Quantel: Device .studioId not set!')

		this.expectedMediaItems = this._coreHandler.core.getCollection('expectedMediaItems')

		// Observe the data:
		const observer = this._coreHandler.core.observe('expectedMediaItems')
		observer.added = this.wrapError(this.onExpectedAdded)
		observer.changed = this.wrapError(this.onExpectedChanged)
		observer.removed = this.wrapError(this.onExpectedRemoved)

		// Subscribe to the data:
		if (this._expectedMediaItemsSubscription) {
			this._coreHandler.core.unsubscribe(this._expectedMediaItemsSubscription)
		}
		this._expectedMediaItemsSubscription = await this._coreHandler.core.subscribe('expectedMediaItems', {
			studioId: this._studioId
		})
		_.each(this.expectedMediaItems.find({
			studioId: this._studioId
		}), doc => {
			this.onExpectedAdded(doc._id, doc as ExpectedMediaItem)
		})
		this.logger.debug(`Quantel: Subscribed to expectedMediaItems for studio "${this._studioId}"`)

		this.observer = observer

		if (!this._settings.gatewayUrl) throw new Error('Quantel: parameter not set: gatewayUrl')
		if (!this._settings.ISAUrl) throw new Error('Quantel: parameter not set: ISAUrl')
		if (!this._settings.serverId) throw new Error('Quantel: parameter not set: serverId')

		// Setup quantel connection:
		await this._quantel.init(
			this._settings.gatewayUrl,
			this._settings.ISAUrl,
			this._settings.zoneId,
			this._settings.serverId
		)
		this._quantel.monitorServerStatus(() => {
			this._updateAndSendStatus()
		})

		// Sync initial file list:
		// TODO: make this work, currently there is a discrepancy in the id..
		const objectRevisions = await this.getAllCoreObjRevisions()
		_.each(objectRevisions, (rev, objId) => {
			this._cachedMediaObjects[objId] = { _id: objId, _rev: rev }
		})

		// Start watching:
		this.triggerWatch()

	}
	async dispose (): Promise<void> {
		await super.dispose()

		this._isDestroyed = true

		this._coreHandler.core.unsubscribe(this._expectedMediaItemsSubscription)
		this.observer.stop()
	}
	private wrapError (fcn) {
		return (...args) => {
			try {
				return fcn(...args)
			} catch (e) {
				this.logger.error(e)
			}
		}
	}
	private shouldHandleItem (obj: ExpectedMediaItem): boolean {
		if (obj.url && obj.url.startsWith(QUANTEL_URL_PROTOCOL)) {
			return true
		}
		return false
	}
	private parseUrlToQuery (queryUrl: string): QuantelClipSearchQuery {
		const parsed = url.parse(queryUrl)
		if (parsed.protocol !== QUANTEL_URL_PROTOCOL) throw new Error(`Unsupported URL format: ${queryUrl}`)
		let guid = decodeURI(parsed.host || parsed.path || '') // host for quantel:030B4A82-1B7C-11CF-9D53-00AA003C9CB6
																 // path for quantel:"030B4A82-1B7C-11CF-9D53-00AA003C9CB6"
		let title = decodeURI(parsed.query || '')				 // query for quantel:?Clip title or quantel:?"Clip title"

		if (guid.startsWith("?")) {	// check if the title wasn't mistakenly matched as GUID
			title = guid
			guid = ''
		}

		if (guid) {
			return {
				ClipGUID: `"${guid}"`
			}
		} else if (title) {
			return {
				Title: `"${title}"`
			}
		}
		throw new Error(`Unsupported URL format: ${queryUrl}`)
	}
	private onExpectedAdded = (id: string, obj?: ExpectedMediaItem) => {
		let item: ExpectedMediaItem
		if (obj) {
			item = obj
		} else {
			item = this.expectedMediaItems.findOne(id) as ExpectedMediaItem
		}
		if (!item) throw new Error(`Could not find the new item "${id}" in expectedMediaItems`)

		// Note: The item.url will contain the clip GUID
		if (item.url && !this.monitoredFiles[item.url]) {
			const shouldHandle = this.shouldHandleItem(item)
			this.logger.debug(`${item.url}`, JSON.stringify(item))
			if (shouldHandle) {
				this.monitoredFiles[item.url] = {
					status: QuantelMonitorFileStatus.UNKNOWN,
					title: '',
					lastChecked: 0,
					url: item.url
			   }
			}
		}
	}
	private onExpectedChanged = (id: string, _oldFields: any, _clearedFields: any, _newFields: any) => {
		let item: ExpectedMediaItem = this.expectedMediaItems.findOne(id) as ExpectedMediaItem
		if (!item) throw new Error(`Could not find the changed item "${id}" in expectedMediaItems`)

		if (item.url && !this.monitoredFiles[item.url]) {
			const shouldHandle = this.shouldHandleItem(item)
			this.logger.debug(`${item.url}`, JSON.stringify(item))
			if (shouldHandle) {
				this.monitoredFiles[item.url] = {
					status: QuantelMonitorFileStatus.UNKNOWN,
					title: '',
					lastChecked: 0,
					url: item.url
			   }
			}
		}
	}
	private onExpectedRemoved = (_id: string, oldValue: ExpectedMediaItem) => {
		if (oldValue.url) {
			delete this.monitoredFiles[oldValue.url]
		}
	}

	private triggerWatch (): void {
		// This function should only be called once during init, and then upon end of this.doWatch()
		setTimeout(() => {
			if (!this._isDestroyed) {
				this.doWatch()
				.catch((e) => {
					this.logger.error('Error in Quantel doWatch:' + e)
				})
			}
		}, BREATHING_ROOM)
	}
	private async doWatch (): Promise<void> {
		try {

			const server = await this._quantel.getServer()
			if (server) {

				const mediaObjects: {[objectId: string]: MediaObject | null} = {}

				// Fetch all url/GUID:s that we are to monitor
				const urls = _.keys(this.monitoredFiles)
				for (let url of urls) {
					if (this._isDestroyed) return // abort checking

					const monitoredFile = this.monitoredFiles[url]

					const timeSinceLastCheck = Date.now() - (monitoredFile.lastChecked || 0)
					const checkTime = (
						monitoredFile.status === QuantelMonitorFileStatus.READY ?
						CHECK_TIME_READY :
						CHECK_TIME_OTHER
					)
					if (timeSinceLastCheck >= checkTime) { // It's time to check the file again

						monitoredFile.lastChecked = Date.now()

						let mediaObject: MediaObject | null = null

						if (url) {
							const clipSummaries = await this._quantel.searchClip(this.parseUrlToQuery(url))
							if (clipSummaries.length >= 1) {
								const clipSummary = _.find(clipSummaries, (clipData) => {
									return (
										clipData.PoolID &&
										(server.pools || []).indexOf(clipData.PoolID) !== -1 && // If present in any of the pools of the server
										parseInt(clipData.Frames, 10) > 0 &&
										clipData.Completed // Nore from Richard: Completed might not necessarily mean that it's completed on the right server
									)
								})
								if (clipSummary) {
									// The clip is present, and on the right server
									this.logger.debug(`Clip "${url}" found`)
									// TODO: perhaps use clipData.Completed ?

									const clipData = await this._quantel.getClip(clipSummary.ClipID)

									if (clipData) {
										// Make our best effort to try to construct a mediaObject:
										mediaObject = {
											mediaId: url.toUpperCase(),
											mediaPath: clipData.ClipGUID,
											mediaSize: 1,
											mediaTime: 0,
											// mediainfo?: MediaInfo,

											thumbSize: 0,
											thumbTime: 0,

											// previewSize?: number,
											// previewTime?: number,

											cinf: '',
											tinf: '',

											_attachments: {},
											_id: getHash(url + clipData.ClipGUID),
											_rev: 'modified' + clipData.Modified
										}
									} else this.logger.warn(`Clip "${url}" summary found, but clip not found when asking for clipId`)
								} else this.logger.debug(`Clip "${url}" found, but doesn't exist on the right server`)
							} else this.logger.debug(`Clip "${url}" not found`)
						} else this.logger.error(`Quantel: Falsy url encountered`)

						let newStatus = (
							mediaObject ?
							QuantelMonitorFileStatus.READY :
							QuantelMonitorFileStatus.MISSING
						)

						monitoredFile.status = newStatus

						mediaObjects[url] = mediaObject
					}
				}

				// Go through the mediaobjects and send changes to core:
				const p = Promise.resolve()
				_.each(mediaObjects, (newMediaObject: MediaObject | null, objectId: string) => {
					const oldMediaObject = this._cachedMediaObjects[objectId]
					if (newMediaObject) {
						if (
							!oldMediaObject ||
							newMediaObject._rev !== oldMediaObject._rev
							) {
							// Added or changed
							p.then(() => this._sendChanged(newMediaObject)).catch((e) => {
								this.logger.error(`MonitorQuantel: Failed to send changes to Core: ${e}`)
							})
						}
					} else {
						if (oldMediaObject) {
							// Removed
							p.then(() => this._sendRemoved(oldMediaObject._id)).catch((e) => {
								this.logger.error(`MonitorQuantel: Failed to send changes to Core: ${e}`)
							})
						}
					}
					if (newMediaObject) {
						this._cachedMediaObjects[objectId] = newMediaObject
					} else {
						delete this._cachedMediaObjects[objectId]
					}
				})
				await p
				// this._cachedMediaObjects = mediaObjects

			} else {
				throw new Error('Quantel: Has no server')
			}
			// last:
			this._watchError = null
			await this.wait(BREATHING_ROOM)
		} catch (e) {
			this._watchError = e.toString()
			this.logger.error('Error in Quantel doWatch:' + e)
		}
		this.triggerWatch()
	}
	private _updateStatus (): PeripheralDeviceAPI.StatusObject {
		let statusSettings: PeripheralDeviceAPI.StatusObject = { statusCode: PeripheralDeviceAPI.StatusCode.GOOD }

		if (!this._settings.gatewayUrl) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "gatewayUrl" not set']
			}
		} else if (!this._settings.storageId) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "storageId" not set']
			}
		} else if (!this._settings.ISAUrl) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "ISAUrl" not set']
			}
		} else if (!this._settings.serverId) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "serverId" not set']
			}
		} else if (!this._quantel.connected) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Quantel: ' + this._quantel.statusMessage]
			}
		} else if (this._watchError) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Quantel: ' + this._watchError]
			}
		}
		return statusSettings
	}
	private _updateAndSendStatus () {
		const status = this._updateStatus()

		if (
			this._status.statusCode !== status.statusCode ||
			!_.isEqual(this._status.messages, status.messages)
		) {
			this._status = {
				statusCode: status.statusCode,
				messages: status.messages
			}
			if (status.statusCode !== PeripheralDeviceAPI.StatusCode.GOOD) {
				this.logger.warn((status.messages || []).join(','))
			}
			this.emit('connectionChanged', this._status)
		}
	}
	private wait (time): Promise<void> {
		return new Promise(resolve => {
			setTimeout(resolve, time)
		})
	}

}
interface QuantelMonitor {
	[guid: string]: QuantelMonitorFile
}
interface QuantelMonitorFile {
	title: string | undefined
	status: QuantelMonitorFileStatus
	lastChecked: number
	url: string
}
enum QuantelMonitorFileStatus {
	UNKNOWN = 0,
	MISSING = 10,
	PENDING = 20,
	READY = 30
}
