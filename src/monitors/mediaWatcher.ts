import * as _ from 'underscore'
import { PeripheralDeviceAPI } from '@sofie-automation/server-core-integration'
import { Monitor } from './_monitor'
import { MonitorDevice } from '../coreHandler'
import {
	MonitorSettingsWatcher,
	MediaObject,
	DiskInfo,
	StorageSettings,
	StorageType,
	LocalFolderStorage,
	FileShareStorage
} from '../api'
import { LoggerInstance } from 'winston'
import { promisify } from 'util'
import { exec as execCB } from 'child_process'
import { Watcher } from './watcher'
const exec = promisify(execCB)

function isLocalFolderStorage(sets: StorageSettings): sets is LocalFolderStorage {
	return sets.type === StorageType.LOCAL_FOLDER
}

function isFileShareStorage(sets: StorageSettings): sets is FileShareStorage {
	return sets.type === StorageType.FILE_SHARE
}

export class MonitorMediaWatcher extends Monitor {
	private triggerupdateFsStatsTimeout?: NodeJS.Timer
	private checkFsStatsInterval?: NodeJS.Timer

	private watcher: Watcher

	constructor(
		deviceId: string,
		db: PouchDB.Database<MediaObject>,
		public monitorSettings: MonitorSettingsWatcher,
		logger: LoggerInstance,
		storageSettings?: StorageSettings
	) {
		super(deviceId, db, monitorSettings, logger, storageSettings)

		if (
			this.storageSettings &&
			(isFileShareStorage(this.storageSettings) || isLocalFolderStorage(this.storageSettings))
		) {
			this.watcher = new Watcher(db, monitorSettings, logger, this.storageSettings)
			this.watcher.init()
		}

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
			this.logger.info(`Initializing media watcher monitor`, this.monitorSettings)

			if (!this.monitorSettings.disable) {
				this.logger.info('Media watcher init')

				this.restartChangesStream()

				this.logger.info('Media watcher: start syncing media files')

				// Check disk usage now
				this.updateFsStats()
				this.checkFsStatsInterval = setInterval(() => {
					this.triggerupdateFsStats()
				}, 30 * 1000) // Run a check every 30 seconds

				const [coreObjRevisions, allDocsResponse, dbInfo] = await Promise.all([
					this.getAllCoreObjRevisions(),
					this.db.allDocs({
						include_docs: true,
						attachments: true
					}),
					this.db.info()
				])

				this.logger.info(
					'Media watcher: sync object lists',
					Object.keys(coreObjRevisions).length,
					allDocsResponse.total_rows
				)

				for (let doc of allDocsResponse.rows) {
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
					} else {
						// identical
						delete coreObjRevisions[docId]
						continue
					}
				}

				if (parseInt(dbInfo.update_seq + '', 10)) {
					this.lastSequenceNr = parseInt(dbInfo.update_seq + '', 10)
				}
				// The ones left in coreObjRevisions have not been touched, ie they should be deleted
				for (let id in coreObjRevisions) {
					await this.sendRemoved(id)
				}

				this.coreHandler.core.onConnected(() => {
					this._status = {
						statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN,
						messages: ['Updating status after recent core connect ...']
					}
					this.updateAndSendStatus()
				})

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

		if (this.checkFsStatsInterval) {
			clearInterval(this.checkFsStatsInterval)
			this.checkFsStatsInterval = undefined
		}
		// await this.db.close()
		if (this.watcher) {
			await this.watcher.dispose()
		}
	}

	protected triggerupdateFsStats(): void {
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
				// Note: the Description (Win) and '-l' flag (Linux) limits this to local disks only.
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
					const { stdout } = await exec(
						'wmic logicaldisk get Caption,Description,FileSystem,FreeSpace,Size',
						{ windowsHide: true }
					)
					let lines = stdout
						.split('\r\n')
						.filter(line => line.trim() !== '')
						.filter((_line, idx) => idx > 0)
					for (let line of lines) {
						let lineMatch = line.match(
							/(?<fs>\w:)\s+(?<desc>(Local Fixed Disk|Network Connection|Removable Disk))\s+(?<type>\w+)\s+(?<free>\d+)\s+(?<size>\d+)/
						)
						if (lineMatch && lineMatch.groups) {
							if (lineMatch.groups.desc !== 'Local Fixed Disk') continue // Only report on local disks
							let [free, size] = [parseInt(lineMatch.groups.free), parseInt(lineMatch.groups.size)]
							disks.push({
								fs: lineMatch.groups.fs,
								type: lineMatch.groups.type,
								size,
								used: size - free,
								use: parseFloat(((100.0 * (size - free)) / size).toFixed(2)),
								mount: lineMatch.groups!.fs
							} as DiskInfo)
						}
					}
					break
				default:
					this.logger.error(`Media watcher: unrecognized platform '${process.platform}'`)
					return
			}
			if (cmd) {
				// some flavour of Unix
				const { stdout } = await exec(cmd)
				let lines = stdout.split('\n')
				for (let line of lines) {
					let lineMatch = line.match(
						/(?<fs>\/\S+)\s+(?<type>\w+)\s+(?<sizeb>\d+)\s+(?<usedb>\d+)\s+(?<avail>\d+)\s+(?<capacity>\d+\%)\s+(?<mount>\S+)/
					)

					if (lineMatch && lineMatch.groups) {
						let [size, used] = [
							parseInt(lineMatch.groups.sizeb) * 1024,
							parseInt(lineMatch.groups.usedb) * 1024
						]
						disks.push({
							fs: lineMatch.groups.fs,
							type: lineMatch.groups.type,
							size,
							used,
							use: parseFloat(((100.0 * used) / size).toFixed(2)),
							mount: lineMatch.groups.mount
						} as DiskInfo)
					}
				}
			}

			let messages: Array<string> = []
			let status = PeripheralDeviceAPI.StatusCode.GOOD
			for (let disk of disks) {
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
		} catch (e) {
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
}
