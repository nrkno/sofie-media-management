import * as _ from 'underscore'
import { PeripheralDeviceAPI } from 'tv-automation-server-core-integration'
import { Monitor } from './_monitor'
import { MonitorDevice } from '../coreHandler'
import { MonitorSettingsWatcher, MediaObject, DiskInfo } from '../api'
import { LoggerInstance } from 'winston'
import { FetchError } from 'node-fetch'
import { promisify } from 'util'
import { exec as execCB } from 'child_process'
import { Watcher } from './watcher'
const exec = promisify(execCB)

export class MonitorMediaWatcher extends Monitor {
	private changes: PouchDB.Core.Changes<MediaObject>
	private triggerupdateFsStatsTimeout?: NodeJS.Timer
	private checkFsStatsInterval?: NodeJS.Timer

	private lastSequenceNr: number = 0

	private monitorConnectionTimeout: NodeJS.Timer | null = null

	private statusDisk: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}

	private statusConnection: PeripheralDeviceAPI.StatusObject = {
		statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
		messages: []
	}

	private isDestroyed: boolean = false
	private initialized: boolean = false

	private watcher: Watcher

	constructor(
		deviceId: string,
		private db: PouchDB.Database<MediaObject>,
		public settings: MonitorSettingsWatcher,
		logger: LoggerInstance
	) {
		super(deviceId, settings, logger)

		this.watcher = new Watcher(db, settings, logger)
		this.watcher.init()
		this.updateStatus()
	}

	get deviceInfo(): MonitorDevice {
		return {
			deviceName: `Media watcher in media manager`,
			deviceId: this.deviceId,

			deviceCategory: PeripheralDeviceAPI.DeviceCategory.MEDIA_MANAGER,
			deviceType: PeripheralDeviceAPI.DeviceType.MEDIA_MANAGER,
			deviceSubType: 'mediascanner'
		}
	}

	public async restart(): Promise<void> {
		throw Error('Media watcher restart not implemented yet')
	}

	public async init(): Promise<void> {
		try {
			this.logger.info(`Initializing media watcher monitor`, this.settings)

			if (!this.settings.disable) {
				this.logger.info('Media watcher init')

				this.restartChangesStream()

				this.logger.info('Media watcher: start syncing media files')

				// Check disk usage now
				this.updateFsStats()
				this.checkFsStatsInterval = setInterval(() => {
					this.triggerupdateFsStats()
				}, 30 * 1000) // Run a check every 30 seconds

				const [ coreObjRevisions, allDocsResponse, dbInfo ] = await Promise.all([
					this.getAllCoreObjRevisions(),
					this.db.allDocs({
						include_docs: true,
						attachments: true
					}),
					this.db.info()
				])

				this.logger.info('Media watcher: sync object lists', Object.keys(coreObjRevisions).length, allDocsResponse.total_rows)

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

						let doc2 = await this.db.get<MediaObject>(doc.id, {
							attachments: true
						})
						doc2.mediaId = doc2._id
						await this.sendChanged(doc2)

						await new Promise(resolve => {
							setTimeout(resolve, 100) // slow it down a bit, maybe remove this later
						})
					} else { // identical
						delete coreObjRevisions[docId]
						continue
					}
				}

				if (parseInt(dbInfo.update_seq + '', 10)) {
					this.lastSequenceNr = parseInt(dbInfo.update_seq + '', 10)
				}
				// The ones left in coreObjRevisions have not been touched, ie they should be deleted
				for ( let id in coreObjRevisions) {
					await this.sendRemoved(id)
				}

				this.logger.info('Media watcher: done file sync init')
			} else {
				this.logger.info('Media watcher disabled')
			}
			this.initialized = true
		} catch (e) {
			this.logger.error('Media watcher: error initializing media watcher', e)
		}
	}

	public async dispose(): Promise<void> {
		await super.dispose()

		this.isDestroyed = true
		if (this.checkFsStatsInterval) {
			clearInterval(this.checkFsStatsInterval)
			this.checkFsStatsInterval = undefined
		}
		if (this.changes) {
			this.changes.cancel()
		}
		// await this.db.close()
		await this.watcher.dispose()
	}

	private triggerupdateFsStats(): void {
		if (!this.triggerupdateFsStatsTimeout) {
			this.triggerupdateFsStatsTimeout = setTimeout(() => {
				this.triggerupdateFsStatsTimeout = undefined
				this.updateFsStats()
			}, 5000)
		}
	}

	private async updateFsStats(): Promise<void> {
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
					this.logger.error(`Media watcher: unrecognized platform '${process.platform}'`)
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
			this.statusDisk.statusCode = status
			this.statusDisk.messages = messages
			this.updateAndSendStatus()
		} catch(e) {
			this.logger.warn('Media watcher: it was not possible to determine disk usage stats.')
			// Removed - not making a network request
			// if (!((e + '').match(/ECONNREFUSED/i) || (e + '').match(/ECONNRESET/i) || (e + '').match(/ENOTFOUND/i))) {
			// 	this.logger.warn('Error in _updateFsStats', e.message || e.stack || e)
			// }

			this.statusDisk.statusCode = PeripheralDeviceAPI.StatusCode.WARNING_MAJOR
			this.statusDisk.messages = [`Media watcher: error when trying to determine disk usage stats.`]
			this.updateAndSendStatus()
		}
	}

	private getChangesOptions() {
		return {
			since: this.lastSequenceNr || 'now',
			include_docs: true,
			live: true,
			attachments: true
		}
	}

	private setConnectionStatus(connected: boolean) {
		let status = connected ? PeripheralDeviceAPI.StatusCode.GOOD : PeripheralDeviceAPI.StatusCode.BAD
		let messages = connected ? [] : ['MediaScanner not connected']
		if (status !== this.statusConnection.statusCode) {
			this.statusConnection.statusCode = status
			this.statusConnection.messages = messages
			this.updateAndSendStatus()
		}
	}

	private updateStatus(): PeripheralDeviceAPI.StatusObject {
		let statusCode: PeripheralDeviceAPI.StatusCode = PeripheralDeviceAPI.StatusCode.GOOD
		let messages: Array<string> = []

		let statusSettings: PeripheralDeviceAPI.StatusObject = { statusCode: PeripheralDeviceAPI.StatusCode.GOOD }

		if (!this.settings.storageId) {
			statusSettings = {
				statusCode: PeripheralDeviceAPI.StatusCode.BAD,
				messages: ['Settings parameter "storageId" not set']
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

	private updateAndSendStatus() {
		const status = this.updateStatus()

		if (
			this.status.statusCode !== status.statusCode
			|| !_.isEqual(this.status.messages, status.messages)
		) {
			this._status = {
				statusCode: status.statusCode,
				messages: status.messages
			}
			this.emit('connectionChanged', this.status)
		}
	}

	private triggerMonitorConnection() {
		if (!this.monitorConnectionTimeout) {
			this.monitorConnectionTimeout = setTimeout(() => {
				this.monitorConnectionTimeout = null
				this.monitorConnection()
			}, 10 * 1000)
		}
	}

	private monitorConnection() {
		if (this.isDestroyed) return

		if (this.statusConnection.statusCode === PeripheralDeviceAPI.StatusCode.BAD) {
			this.restartChangesStream(true)

			this.triggerMonitorConnection()
		}
	}

	private restartChangesStream(rewindSequence?: boolean) {
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

	private changeHandler(changes: PouchDB.Core.ChangesResponseChange<MediaObject>) {
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

	private errorHandler(err) {
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
}
