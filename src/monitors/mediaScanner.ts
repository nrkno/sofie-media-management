
import * as PouchDB from 'pouchdb-node'
import * as _ from 'underscore'
import * as PromiseSequence from 'promise-sequence'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import axios from 'axios'
import { Monitor } from './_monitor'
import { MonitorDevice } from '../coreHandler'
import { MonitorSettingsMediaScanner, MediaObject, DiskInfo } from '../api'
import { LoggerInstance } from 'winston'

export class MonitorMediaScanner extends Monitor {

	protected _settings: MonitorSettingsMediaScanner

	private _db: PouchDB.Database
	private _remote: PouchDB.Database

	private _changes: PouchDB.Core.Changes<MediaObject>
	private _doReplication: boolean = false
	private _triggerupdateFsStatsTimeout?: NodeJS.Timer
	private _checkFsStatsInterval?: NodeJS.Timer

	private _lastSequenceNr: number = 0

	private _monitorConnectionTimeout: NodeJS.Timer | null = null

	private _statusDisk: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}
	private _statusConnection: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}

	private _replication: PouchDB.Replication.Replication<{}>
	private _isDestroyed: boolean = false
	private _initialized: boolean = false

	constructor (deviceId: string, _settings: MonitorSettingsMediaScanner, logger: LoggerInstance) {
		super(deviceId, _settings, logger)

		this._updateStatus()
	}

	get deviceInfo (): MonitorDevice {
		return {
			deviceName: `MediaScanner (${this._settings.host}:${this._settings.port})`,
			deviceId: this.deviceId,

			deviceCategory: PeripheralDeviceAPI.DeviceCategory.MEDIA_MANAGER,
			deviceType: PeripheralDeviceAPI.DeviceType.MEDIA_MANAGER,

			// @ts-ignore: todo: make stronger typed, via core-integration
			deviceSubType: 'mediascanner'
		}
	}
	public async restart (): Promise<void> {
		throw Error('MediaScanner restart not implemented yet')
	}
	public async init (): Promise<void> {
		try {
			this.logger.info(`Initializing MediaScanner-monitor`, this._settings)

			if (!this._settings.disable) {

				this.logger.info('MediaScanner init')

				const baseUrl = 'http://' + this._settings.host + ':' + this._settings.port

				if (this._doReplication) {
					this._db = new PouchDB('local')
					this._remote = new PouchDB(`${baseUrl}/db/_media`)
					this._replication = this._remote.replicate.to(this._db, { live: true, retry: true })
				} else {
					this._db = new PouchDB(`${baseUrl}/db/_media`)
				}

				this._restartChangesStream()

				this.logger.info('MediaScanner: Start syncing media files')

				// Check disk usage now
				this._updateFsStats()
				this._checkFsStatsInterval = setInterval(() => {
					this._triggerupdateFsStats()
				}, 30 * 1000) // Run a check every 30 seconds

				const r = await Promise.all([
					this.getAllCoreObjRevisions(),
					this._db.allDocs({
						include_docs: true,
						attachments: true
					}),
					this._db.info()
				])

				const coreObjRevisions = r[0]
				const allDocsResponse = r[1]
				const dbInfo = r[2]

				this.logger.info('MediaScanner: synk objectlists', coreObjRevisions.length, allDocsResponse.total_rows)

				const tasks: Array<() => Promise<any>> = _.compact(_.map(allDocsResponse.rows, (doc) => {
					const docId = this.hashId(doc.id)

					if (doc.value.deleted) {
						if (coreObjRevisions[docId]) {
							// deleted
						}
						return null // handled later
					} else if (
						!coreObjRevisions[docId] ||				// created
						coreObjRevisions[docId] !== doc.value.rev	// changed
					) {
						delete coreObjRevisions[docId]

						return async () => {
							const doc2 = await this._db.get<MediaObject>(doc.id, {
								attachments: true
							})
							await this._sendChanged(doc2)

							await new Promise(resolve => {
								setTimeout(resolve, 100) // slow it down a bit, maybe remove this later
							})

						}
					} else {
						delete coreObjRevisions[docId]
						// identical
						return null
					}
				}))
				if (parseInt(dbInfo.update_seq + '', 10)) this._lastSequenceNr = parseInt(dbInfo.update_seq + '', 10)
				// The ones left in coreObjRevisions have not been touched, ie they should be deleted
				_.each(coreObjRevisions, (_rev, id) => {
					// deleted

					tasks.push(
						async () => {
							await this._sendRemoved(id)
						}
					)
				})
				await PromiseSequence(tasks)

				this.logger.info('MediaScanner: Done file sync init')

			} else {
				this.logger.info('MediaScanner disabled')
			}
			this._initialized = true
		} catch (e) {
			this.logger.error('MediaScanner: Error initializing MediaScanner', e)
		}
	}

	public async dispose (): Promise<void> {
		await super.dispose()

		this._isDestroyed = true
		if (this._checkFsStatsInterval) {
			clearInterval(this._checkFsStatsInterval)
			this._checkFsStatsInterval = undefined
		}
		if (this._changes) {
			this._changes.cancel()
		}
		if (this._replication) {
			this._replication.cancel()
		}
		await this._db.close()

		if (this._remote) {
			await this._remote.close()
		}
	}
	private _triggerupdateFsStats (): void {
		if (!this._triggerupdateFsStatsTimeout) {
			this._triggerupdateFsStatsTimeout = setTimeout(() => {
				this._triggerupdateFsStatsTimeout = undefined
				this._updateFsStats()
			}, 5000)
		}
	}
	private _updateFsStats (): void {

		(async () => {

			const response = await axios.get(`http://${this._settings.host}:${this._settings.port}/stat/fs`)
			const disks: Array<DiskInfo> = response.data

			// @todo: we temporarily report under playout-gateway, until we can handle multiple media-scanners
			let messages: Array<string> = []
			let status = PeripheralDeviceAPI.StatusCode.GOOD
			_.each(disks, (disk) => {

				let diskStatus = PeripheralDeviceAPI.StatusCode.GOOD
				if (disk.use) {
					if (disk.use > 75) {
						diskStatus = PeripheralDeviceAPI.StatusCode.WARNING_MAJOR
						messages.push(`Disk usage for ${disk.fs} is at ${disk.use}%, this may cause degraded performance.`)
					} else if (disk.use > 60) {
						diskStatus = PeripheralDeviceAPI.StatusCode.WARNING_MINOR
						messages.push(`Disk usage for ${disk.fs} is at ${disk.use}%, this may cause degraded performance.`)
					}
				}

				if (diskStatus > status) {
					status = diskStatus
				}
			})
			this._statusDisk.statusCode = status
			this._statusDisk.messages = messages
			this._updateAndSendStatus()

		})()
		.catch((e) => {
			this.logger.warn('It appears as if media-scanner does not support disk usage stats.')
			if (
				!(
					(e + '').match(/ECONNREFUSED/i) ||
					(e + '').match(/ECONNRESET/i) ||
					(e + '').match(/ENOTFOUND/i)
				)
			) {
				this.logger.warn('Error in _updateFsStats', e.message || e.stack || e)
			}

			this._statusDisk.statusCode = PeripheralDeviceAPI.StatusCode.WARNING_MAJOR
			this._statusDisk.messages = [`Unable to fetch disk status from media-scanner`]
			this._updateAndSendStatus()
		})
	}
	private getChangesOptions () {
		return {
			since: this._lastSequenceNr || 'now',
			include_docs: true,
			live: true,
			attachments: true
		}
	}
	private _setConnectionStatus (connected) {
		let status = (
			connected ?
			PeripheralDeviceAPI.StatusCode.GOOD :
			PeripheralDeviceAPI.StatusCode.BAD
		)
		let messages = (
			connected ?
			[] :
			['MediaScanner not connected']
		)
		if (status !== this._statusConnection.statusCode) {
			this._statusConnection.statusCode = status
			this._statusConnection.messages = messages
			this._updateAndSendStatus()
		}
	}
	private _updateStatus (): PeripheralDeviceAPI.StatusObject {

		let statusCode: PeripheralDeviceAPI.StatusCode = PeripheralDeviceAPI.StatusCode.GOOD
		let messages: Array<string> = []

		let statusSettings: PeripheralDeviceAPI.StatusObject = { statusCode: PeripheralDeviceAPI.StatusCode.GOOD }

		if (!this._settings.host) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "host" not set']
			}
		} else if (!this._settings.port) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "port" not set']
			}
		} else if (!this._settings.storageId) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "storageId" not set']
			}
		} else if (!this._initialized) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Not initialized']
			}
		}

		_.each([
			statusSettings,
			this._statusConnection,
			this._statusDisk
		], (s) => {
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
			this.emit('connectionChanged', this._status)
		}
	}

	private _triggerMonitorConnection () {
		if (!this._monitorConnectionTimeout) {
			this._monitorConnectionTimeout = setTimeout(() => {
				this._monitorConnectionTimeout = null
				this._monitorConnection()
			}, 10 * 1000)
		}
	}
	private _monitorConnection () {
		if (this._isDestroyed) return

		if (this._statusConnection.statusCode === PeripheralDeviceAPI.StatusCode.BAD) {
			this._restartChangesStream(true)

			this._triggerMonitorConnection()
		}
	}
	private _restartChangesStream (rewindSequence?: boolean) {

		if (rewindSequence) {
			if (this._lastSequenceNr > 0) {
				this._lastSequenceNr--
			}
		}
		// restart the changes stream
		if (this._changes) {
			this._changes.cancel()
		}
		const opts = this.getChangesOptions()
		this.logger.info(`MediaScanner: Restarting changes stream (since ${opts.since})`)
		this._changes = this._db.changes<MediaObject>(opts)
			.on('change', changes => this._changeHandler(changes))
			.on('error', error => this._errorHandler(error))
	}
	private _changeHandler (changes: PouchDB.Core.ChangesResponseChange<MediaObject>) {
		const newSequenceNr: string | number = changes.seq
		if (_.isNumber(newSequenceNr)) this._lastSequenceNr = newSequenceNr
		else this.logger.warn(`Expected changes.seq to be number, got "${newSequenceNr}"`)

		if (changes.deleted) {
			if (!(changes.id + '').match(/watchdogIgnore/i)) { // Ignore watchdog file changes

				this.logger.debug('MediaScanner: deleteMediaObject', changes.id, newSequenceNr)
				this._sendRemoved(changes.id)
				.catch((e) => {
					this.logger.error('MediaScanner: Error sending deleted doc', e)
				})
			}
		} else if (changes.doc) {
			const md: MediaObject = changes.doc
			if (!(md._id + '').match(/watchdogIgnore/i)) { // Ignore watchdog file changes

				this.logger.debug('MediaScanner: updateMediaObject', newSequenceNr, md._id, md.mediaId)
				this._sendChanged(md)
				.catch((e) => {
					this.logger.error('MediaScanner: Error sending changed doc', e)
				})

				// const previewUrl = `${baseUrl}/media/preview/${md._id}`
				// Note: it only exists if there is a previewTime or previewSize set in the doc
			}
		}

		this._setConnectionStatus(true)

		this._triggerupdateFsStats()
	}
	private _errorHandler (err) {
		if (
			err.code === 'ECONNREFUSED' ||
			err.code === 'ECONNRESET'
		) {
			// TODO: try to reconnect
			this.logger.warn('MediaScanner: ' + err.code)
		} else if (err instanceof SyntaxError) {
			this.logger.warn('MediaScanner: Connection terminated (' + err.message + ')') // most likely
			// TODO: try to reconnect
		} else {
			this.logger.error('MediaScanner: Error', err)
		}

		this._setConnectionStatus(false)

		this._triggerMonitorConnection()
	}
}

/**
 * Represents a connection between Gateway and Media-Scanner
 */
