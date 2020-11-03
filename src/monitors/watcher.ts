import { EventEmitter } from 'events'
import * as path from 'path'
import * as chokidar from 'chokidar'
import { noTryAsync } from 'no-try'
import { MonitorSettingsWatcher, MediaObject, LocalFolderStorage, FileShareStorage } from '../api'
import { LoggerInstance } from 'winston'
import { Stats, stat } from 'fs-extra'
import { literal } from '../lib/lib'

/** Convert filename to Caspar-style name. */
function getId(fileDir: string, filePath: string): string {
	return path
		.relative(fileDir, filePath)
		.replace(/\.[^/.]+$/, '')
		.replace(/\\+/g, '/')
		.toUpperCase()
}

const fileExists = async (destPath: string) => {
	const { result, error } = await noTryAsync(() => stat(destPath))
	if (error) return false
	return result.isFile()
}

interface FileToScan {
	mediaPath: string
	mediaId: string
	mediaStat: Stats
	// generateInfoWhenFound: boolean
}

/**
 *  Replacement for the core scanning capability of media scanner - watching
 *  for file changes.
 */
export class Watcher extends EventEmitter {
	private watcher: chokidar.FSWatcher
	private scanning = false
	private scanId = 1
	private filesToScan: { [mediaId: string]: FileToScan } = {}
	private filesToScanFail: { [mediaId: string]: number } = {}
	private retrying = false

	constructor(
		private db: PouchDB.Database<MediaObject>,
		private monitorSettings: MonitorSettingsWatcher,
		private logger: LoggerInstance,
		private storageSettings: LocalFolderStorage | FileShareStorage
	) {
		super()
	}

	public init(): void {
		if (!this.storageSettings) return
		this.watcher = chokidar.watch(
			this.storageSettings.options.basePath,
			Object.assign(
				{
					alwaysStat: true,
					awaitWriteFinish: {
						stabilityThreshold: 4000,
						pollInterval: 1000
					}
				},
				this.monitorSettings.scanner
			)
		)
		this.watcher.on('add', (localPath: string, stat: Stats): void => {
			const mediaId = getId(this.storageSettings.options.basePath, localPath)
			this.scanFile(localPath, mediaId, stat).catch((error) => {
				this.logger.error(error)
			})
		})
		this.watcher.on('change', (localPath: string, stat: Stats) => {
			const mediaId = getId(this.storageSettings.options.basePath, localPath)
			this.scanFile(localPath, mediaId, stat).catch((error) => {
				this.logger.error(error)
			})
		})
		this.watcher.on('unlink', (localPath: string, _stat: Stats) => {
			const mediaId = getId(this.storageSettings.options.basePath, localPath)
			this.db
				.get(mediaId)
				.then((doc) => this.db.remove(doc))
				.catch((error) => {
					this.logger.error(error)
				})
		})
		this.watcher.on('ready', () => {
			this.logger.info('Watcher: ready!')
		})
		this.watcher.on('error', (err) => {
			if (err) {
				this.logger.error(`Watcher: error: ${err.message}`, err)
			}
		})

		this.cleanDeleted()
	}

	public async dispose(): Promise<void> {
		// await this.db.close()
		await this.watcher.close()
		this.logger.info('Watcher: stopped')
	}

	private async scanFile(
		mediaPath: string,
		mediaId: string,
		mediaStat: Stats //,
		// generateInfoWhenFound: boolean
	) {
		const { error } = await noTryAsync(async () => {
			if (!mediaId || mediaStat.isDirectory()) {
				return
			}
			this.filesToScan[mediaId] = literal<FileToScan>({
				mediaPath,
				mediaId,
				mediaStat
			})
			if (this.scanning) {
				return
			}
			this.scanning = true
			this.scanId++
			// lastProgressReportTimestamp = new Date()

			const doc: MediaObject = await this.db.get(mediaId).catch(() => ({ _id: mediaId } as MediaObject))

			const mediaLogger = (level: string, message: string): void => {
				this.logger[level](`Watcher: ${message}`, {
					id: mediaId,
					path: mediaPath,
					size: mediaStat.size,
					mtime: mediaStat.mtime.toISOString()
				})
			}

			if (doc.mediaPath && doc.mediaPath !== mediaPath) {
				mediaLogger('info', 'skipped - matching path')
				delete this.filesToScanFail[mediaId]
				delete this.filesToScan[mediaId]
				this.scanning = false
				return
			}

			// Database file and file on disk are likely the same ... no change
			if (doc.mediaSize === mediaStat.size && doc.mediaTime === mediaStat.mtime.getTime()) {
				mediaLogger('info', 'skipped - matching size and time')
				this.scanning = false
				delete this.filesToScanFail[mediaId]
				delete this.filesToScan[mediaId]
				return
			}

			doc.mediaPath = mediaPath
			doc.mediaSize = mediaStat.size
			doc.mediaTime = mediaStat.mtime.getTime()

			// Assuming generateInfoWhenFound is always false - use work steps
			// if (generateInfoWhenFound) { // Check if basic file probe should be run in manualMode
			//   await generateInfo(doc).catch(err => {
			//     mediaLogger.error({ err }, 'Info Failed')
			//   })
			// }

			await this.db.put(doc)
			delete this.filesToScanFail[mediaId]
			delete this.filesToScan[mediaId]
			this.scanning = false
			mediaLogger('info', 'scanned')
			this.retryScan()
		})
		if (error) {
			this.scanning = false
			this.filesToScanFail[mediaId] = (this.filesToScanFail[mediaId] || 0) + 1
			if (this.filesToScanFail[mediaId] >= this.monitorSettings.retryLimit) {
				this.logger.error(`Media watching: skipping file. Too many retries for '${mediaId}'`)
				delete this.filesToScanFail[mediaId]
				delete this.filesToScan[mediaId]
			}
			this.retryScan()
			throw error
		}
	}

	async retryScan(): Promise<void> {
		if (this.retrying) {
			return
		}
		this.retrying = true
		let redoRetry = false
		for (const fileObject of Object.values(this.filesToScan)) {
			const { error } = await noTryAsync(async () => {
				await this.scanFile(fileObject.mediaPath, fileObject.mediaId, fileObject.mediaStat)

				delete this.filesToScan[fileObject.mediaId]
			})
			if (error) {
				redoRetry = true
			}
		}
		this.retrying = false
		if (redoRetry) {
			this.retryScan()
		}
	}

	private async cleanDeleted() {
		this.logger.info('Media watching: checking for dead media')
		const limit = 256
		let startkey: string | undefined = undefined
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const deleted: Array<PouchDB.Core.PutDocument<MediaObject>> = []

			const result: PouchDB.Core.AllDocsResponse<MediaObject> = await this.db.allDocs({
				include_docs: true,
				startkey,
				limit
			})
			await Promise.all(
				result.rows.map(async ({ doc }) => {
					if (!doc) return Promise.resolve()
					const { error } = await noTryAsync(async () => {
						const mediaFolder = path.normalize(this.storageSettings.options.basePath)
						const mediaPath = path.normalize(doc.mediaPath)
						this.logger.debug(
							`Delete test: mediaPath = ${mediaPath} mediaFolder = ${mediaFolder} indexOf=${mediaPath.indexOf(
								mediaFolder
							)}`
						)
						if (mediaPath.indexOf(mediaFolder) === 0 && (await fileExists(doc?.mediaPath ?? ''))) {
							return
						}

						deleted.push(
							literal<PouchDB.Core.PutDocument<MediaObject>>({
								_id: doc._id,
								_rev: doc._rev,
								_deleted: true
							} as MediaObject & PouchDB.Core.ChangesMeta)
						)
					})
					if (error) {
						this.logger.error(`Media scanning: failed `, error, doc)
					}
				})
			)

			this.logger.debug(`About to delete media objects ${deleted.map((x) => x._id)}`)
			await this.db.bulkDocs(deleted)

			if (result.rows.length < limit) {
				break
			}
			startkey = result.rows[result.rows.length - 1].doc?._id
		}

		this.logger.info(`Media scanning: finished check for dead media`)
	}

	getCurrentScanId = (): number | false => (this.scanning ? this.scanId : false)
}
