import * as PouchDB from 'pouchdb-node'
import * as _ from 'underscore'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { Monitor } from './_monitor'
import { MonitorDevice } from '../coreHandler'
import { MonitorSettingsMediaScanner, MediaObject, DiskInfo } from '../api'
import { LoggerInstance } from 'winston'
import { FetchError } from 'node-fetch'
import { promisify } from 'util'
import { exec as execCB } from 'child_process'
const exec = promisify(execCB)

export class MonitorMediaScanner extends Monitor {
	protected _settings: MonitorSettingsMediaScanner

	private _db: PouchDB.Database

	private _changes: PouchDB.Core.Changes<MediaObject>
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

	private _isDestroyed: boolean = false
	private _initialized: boolean = false

	constructor(deviceId: string, _settings: MonitorSettingsMediaScanner, logger: LoggerInstance) {
		super(deviceId, _settings, logger)

		this._updateStatus()
	}

	get deviceInfo(): MonitorDevice {
		return {
			deviceName: `Media scanning in media manager`,
			deviceId: this.deviceId,

			deviceCategory: PeripheralDeviceAPI.DeviceCategory.MEDIA_MANAGER,
			deviceType: PeripheralDeviceAPI.DeviceType.MEDIA_MANAGER,
			deviceSubType: 'mediascanner'
		}
	}
	public async restart(): Promise<void> {
		throw Error('Media scanning restart not implemented yet')
	}
	public async init(): Promise<void> {
		try {
			this.logger.info(`Initializing media scanning monitor`, this._settings)

			if (!this._settings.disable) {
				this.logger.info('Media scanning init')

				this._db = new PouchDB(`db/_media`)

				this._restartChangesStream()

				this.logger.info('Media scanning: start syncing media files')

				// Check disk usage now
				this._updateFsStats()
				this._checkFsStatsInterval = setInterval(() => {
					this._triggerupdateFsStats()
				}, 30 * 1000) // Run a check every 30 seconds

				const [ coreObjRevisions, allDocsResponse, dbInfo ] = await Promise.all([
					this.getAllCoreObjRevisions(),
					this._db.allDocs({
						include_docs: true,
						attachments: true
					}),
					this._db.info()
				])

				this.logger.info('Media scanning: sync object lists', coreObjRevisions.length, allDocsResponse.total_rows)

				for ( let doc of allDocsResponse.rows ) {
					const docId = this.hashId(doc.id)

					if (doc.value.deleted) {
						if (coreObjRevisions[docId]) {
							// deleted
						}
						continue
					} else if (
						!coreObjRevisions[docId] || // created
						coreObjRevisions[docId] !== doc.value.rev // changed
					) {
						delete coreObjRevisions[docId]

						let doc2 = await this._db.get<MediaObject>(doc.id, {
							attachments: true
						})
						doc2.mediaId = doc2._id
						await this._sendChanged(doc2)

						await new Promise(resolve => {
							setTimeout(resolve, 100) // slow it down a bit, maybe remove this later
						})
					} else { // identical
						delete coreObjRevisions[docId]
						continue
					}
				}

				if (parseInt(dbInfo.update_seq + '', 10)) {
					this._lastSequenceNr = parseInt(dbInfo.update_seq + '', 10)
				}
				// The ones left in coreObjRevisions have not been touched, ie they should be deleted
				for ( let id in coreObjRevisions) {
					await this._sendRemoved(id)
				}

				this.logger.info('Media scanning: done file sync init')
			} else {
				this.logger.info('Media scanning disabled')
			}
			this._initialized = true
		} catch (e) {
			this.logger.error('Media scanning: error initializing media scanning', e)
		}
	}

	public async dispose(): Promise<void> {
		await super.dispose()

		this._isDestroyed = true
		if (this._checkFsStatsInterval) {
			clearInterval(this._checkFsStatsInterval)
			this._checkFsStatsInterval = undefined
		}
		if (this._changes) {
			this._changes.cancel()
		}
		await this._db.close()
	}
	private _triggerupdateFsStats(): void {
		if (!this._triggerupdateFsStatsTimeout) {
			this._triggerupdateFsStatsTimeout = setTimeout(() => {
				this._triggerupdateFsStatsTimeout = undefined
				this._updateFsStats()
			}, 5000)
		}
	}
	private async _updateFsStats(): Promise<void> {
		try {
			let disks: Array<DiskInfo> = []
			let cmd = ''
			switch (process.platform) {
				// Note: the '-l' flag limits this to local disks only.
				case 'darwin':
				  cmd = 'df -lkP | grep ^/'
					break
				case 'linux':
				  cmd = 'df -lkPT | grep ^/'
					break
				case 'openbsd':
				case 'freebsd':
				  cmd = 'df -lkPT'
				  break
				case 'win32':
					const { stdout } = await exec('wmic logicaldisk get Caption,FileSystem,FreeSpace,Size', { windowsHide: true })
					let lines = stdout.split('\r\n').filter(line => line.trim() !== '').filter((_line, idx) => idx > 0)
				 	for ( let line of lines ) {
						let lineMatch = line.match(/(?<fs>\w:)\s+(?<type>\w+)\s+(?<free>\d+)\s+(?<size>\d+)/)
						if (lineMatch && lineMatch.groups) {
							let [ free, size ] = [ parseInt(lineMatch.groups.free), parseInt(lineMatch.groups.size) ]
							disks.push({
								fs: lineMatch.groups.fs,
								type: lineMatch.groups.type,
								size,
								used: size - free,
								use: parseFloat((100.0 * (size - free) / size).toFixed(2)),
								mount: lineMatch.groups!.fs
							} as DiskInfo)
						}
					}
					break
				default:
					this.logger.error(`Media scanning: unrecognized platform '${process.platform}'`)
					return
			}
			if (cmd) { // some flavour of Unix
				const { stdout } = await exec(cmd)
				let lines = stdout.split('\n')
				for ( let line of lines ) {
					let lineMatch = line.match(
						/(?<fs>\/\S+)\s+(?<type>\w+)\s+(?<sizeb>\d+)\s+(?<usedb>\d+)\s+(?<avail>\d+)\s+(?<capacity>\d+\%)\s+(?<mount>\S+)/)

					if (lineMatch && lineMatch.groups) {
						let [ size, used ] = [ parseInt(lineMatch.groups.sizeb) * 1024, parseInt(lineMatch.groups.usedb) * 1024 ]
						disks.push({
							fs: lineMatch.groups.fs,
							type: lineMatch.groups.type,
							size,
							used,
							use: parseFloat((100.0 * used / size).toFixed(2)),
							mount: lineMatch.groups.mount
						} as DiskInfo)
					}
				}
			}
			// @todo: we temporarily report under playout-gateway, until we can handle multiple media-scanners
			let messages: Array<string> = []
			let status = PeripheralDeviceAPI.StatusCode.GOOD
			for ( let disk of disks ) {
				let diskStatus = PeripheralDeviceAPI.StatusCode.GOOD
				if (disk.use) {
					if (disk.use > 75) {
						diskStatus = PeripheralDeviceAPI.StatusCode.WARNING_MAJOR
						messages.push(
							`Disk usage for ${disk.fs} is at ${disk.use}%, this may cause degraded performance.`
						)
					} else if (disk.use > 60) {
						diskStatus = PeripheralDeviceAPI.StatusCode.WARNING_MINOR
						messages.push(
							`Disk usage for ${disk.fs} is at ${disk.use}%, this may cause degraded performance.`
						)
					}
				}

				if (diskStatus > status) {
					status = diskStatus
				}
			}
			this._statusDisk.statusCode = status
			this._statusDisk.messages = messages
			this._updateAndSendStatus()
		} catch(e) {
			this.logger.warn('Media scanning: it was not possible to determine disk usage stats.')
			// Removed - not making a network request
			// if (!((e + '').match(/ECONNREFUSED/i) || (e + '').match(/ECONNRESET/i) || (e + '').match(/ENOTFOUND/i))) {
			// 	this.logger.warn('Error in _updateFsStats', e.message || e.stack || e)
			// }

			this._statusDisk.statusCode = PeripheralDeviceAPI.StatusCode.WARNING_MAJOR
			this._statusDisk.messages = [`Media scanning: error when trying to determine disk usage stats.`]
			this._updateAndSendStatus()
		}
	}

	private getChangesOptions() {
		return {
			since: this._lastSequenceNr || 'now',
			include_docs: true,
			live: true,
			attachments: true
		}
	}
	private _setConnectionStatus(connected: boolean) {
		let status = connected ? PeripheralDeviceAPI.StatusCode.GOOD : PeripheralDeviceAPI.StatusCode.BAD
		let messages = connected ? [] : ['MediaScanner not connected']
		if (status !== this._statusConnection.statusCode) {
			this._statusConnection.statusCode = status
			this._statusConnection.messages = messages
			this._updateAndSendStatus()
		}
	}
	private _updateStatus(): PeripheralDeviceAPI.StatusObject {
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

		_.each([statusSettings, this._statusConnection, this._statusDisk], s => {
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
	private _updateAndSendStatus() {
		const status = this._updateStatus()

		if (this._status.statusCode !== status.statusCode || !_.isEqual(this._status.messages, status.messages)) {
			this._status = {
				statusCode: status.statusCode,
				messages: status.messages
			}
			this.emit('connectionChanged', this._status)
		}
	}

	private _triggerMonitorConnection() {
		if (!this._monitorConnectionTimeout) {
			this._monitorConnectionTimeout = setTimeout(() => {
				this._monitorConnectionTimeout = null
				this._monitorConnection()
			}, 10 * 1000)
		}
	}
	private _monitorConnection() {
		if (this._isDestroyed) return

		if (this._statusConnection.statusCode === PeripheralDeviceAPI.StatusCode.BAD) {
			this._restartChangesStream(true)

			this._triggerMonitorConnection()
		}
	}
	private _restartChangesStream(rewindSequence?: boolean) {
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
		this.logger.info(`Media scanning: restarting changes stream (since ${opts.since})`)
		this._changes = this._db
			.changes<MediaObject>(opts)
			.on('change', changes => this._changeHandler(changes))
			.on('error', error => this._errorHandler(error))
	}
	private _changeHandler(changes: PouchDB.Core.ChangesResponseChange<MediaObject>) {
		const newSequenceNr: string | number = changes.seq
		if (_.isNumber(newSequenceNr)) this._lastSequenceNr = newSequenceNr
		else this.logger.warn(`Expected changes.seq to be number, got "${newSequenceNr}"`)

		if (changes.deleted) {
			if (!(changes.id + '').match(/watchdogIgnore/i)) {
				// Ignore watchdog file changes

				this.logger.debug('Media scanning: deleteMediaObject', changes.id, newSequenceNr)
				this._sendRemoved(changes.id).catch(e => {
					this.logger.error('Media scanning: error sending deleted doc', e)
				})
			}
		} else if (changes.doc) {
			const md: MediaObject = changes.doc
			if (!(md._id + '').match(/watchdogIgnore/i)) {
				// Ignore watchdog file changes

				this.logger.debug('Media scanning: updateMediaObject', newSequenceNr, md._id, md.mediaId)
				md.mediaId = md._id
				this._sendChanged(md).catch(e => {
					this.logger.error('Media scanning: error sending changed doc', e)
				})
			}
		}

		this._setConnectionStatus(true)

		this._triggerupdateFsStats()
	}
	private _errorHandler(err) {
		if (err instanceof SyntaxError || err instanceof FetchError || err.type === 'invalid-json') {
			this.logger.warn('Media scanning: terminated (' + err.message + ')') // not a connection issue
			this._restartChangesStream(true)
			return // restart silently, since PouchDB connections can drop from time to time and are not a very big issue
		} else {
			this.logger.error('MediaScanner: Error', err)
		}

		this._setConnectionStatus(false)

		this._triggerMonitorConnection()
	}
}
