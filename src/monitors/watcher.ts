import { EventEmitter } from 'events'
import * as path from 'path'
import * as PouchDB from 'pouchdb-node'
import * as chokidar from 'chokidar'
import { noTryAsync } from 'no-try'
import { MonitorSettingsMediaScanner } from '../api'
import { LoggerInstance } from 'winston'
import { Stats, stat } from 'fs-extra'
import { literal } from '../lib/lib'

/** Convert filename to Caspar-style name. */
function getId (fileDir: string, filePath: string): string {
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

interface MediaDocument extends PouchDB.Core.IdMeta, PouchDB.Core.GetMeta {
	mediaPath?: string
	mediaSize?: number
	mediaTime?: number
}

/**
 *  Replacement for the core scanning capability of media scanner - watching
 *  for file changes.
 */
export class Watcher extends EventEmitter {
	private db: PouchDB.Database
	private watcher: chokidar.FSWatcher
	private scanning: boolean = false
	private scanId: number = 1
	private filesToScan: { [mediaId: string] : FileToScan } = {}
	private filesToScanFail: { [mediaId: string] : number } = {}
	private retrying: boolean = false

	constructor(
		// private deviceId: string,
		private settings: MonitorSettingsMediaScanner,
		private logger: LoggerInstance
	) {
		super()
	}

  public init() {
		this.db = new PouchDB(`db/_media`)

		this.watcher = chokidar.watch(this.settings.paths, Object.assign({
			alwaysStat: true,
			awaitWriteFinish: {
				stabilityThreshold: 4000,
				pollInterval: 1000
			}
		}, this.settings.scanner))
		this.watcher.on('add', (localPath: string, stat: Stats): void => {
			const mediaId = getId(this.settings.caspar.mediaPath, localPath)
			this.scanFile(localPath, mediaId, stat)
				.catch(error => { this.logger.error(error) })
		})
		this.watcher.on('change', (localPath: string, stat: Stats) => {
			const mediaId = getId(this.settings.caspar.mediaPath, localPath)
			this.scanFile(localPath, mediaId, stat)
				.catch(error => { this.logger.error(error) })
		})
		this.watcher.on('unlink', (localPath: string, _stat: Stats) => {
			const mediaId = getId(this.settings.caspar.mediaPath, localPath)
			this.db.get(mediaId)
				.then((doc) => this.db.remove(doc))
				.catch(error => { this.logger.error(error) })
		})
		this.watcher.on('ready', () => {
			this.logger.info('Media scanning: watcher ready!')
		})
		this.watcher.on('error', (err) => {
			if (err) {
				this.logger.error(`Media scanner: error from watcher: ${err.message}`, err)
			}
		})

	  this.cleanDeleted()
	}

	public async dispose(): Promise<void> {
		await this.db.close()
		await this.watcher.close()
		this.logger.info('Media scanner: watcher stopped')
	}

	private async scanFile (
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
			  mediaPath, mediaId, mediaStat
			})
			if (this.scanning) {
			  return
			}
			this.scanning = true
			this.scanId++
			// lastProgressReportTimestamp = new Date()

			const doc: MediaDocument = await this.db
			  .get<MediaDocument>(mediaId)
			  .catch(() => ({ _id: mediaId } as MediaDocument))

			const mediaLogger = (level: string, message: string): void => {
				this.logger[level](`Media scanning: scanning ${({
					id: mediaId,
					path: mediaPath,
					size: mediaStat.size,
					mtime: mediaStat.mtime.toISOString()
				})}: ${message}`)
			}

			if (doc.mediaPath && doc.mediaPath !== mediaPath) {
				mediaLogger('info', 'skipped - matching path')
				delete this.filesToScanFail[mediaId]
			  delete this.filesToScan[mediaId]
			  this.scanning = false
			  return
			}

			// Database file and file on disk are likely the same ... no change
			if (doc.mediaSize === mediaStat.size &&
					doc.mediaTime === mediaStat.mtime.getTime()
			) {
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
			if (this.filesToScanFail[mediaId] >= this.settings.retryLimit) {
			  this.logger.error(`Media scanner: skipping file. Too many retries for '${mediaId}'`)
			  delete this.filesToScanFail[mediaId]
			  delete this.filesToScan[mediaId]
			}
			this.retryScan()
			throw error
		}
	}

	async retryScan () {
	  if (this.retrying) {
			return
	  }
	  this.retrying = true
	  let redoRetry = false
	  for (const fileObject of Object.values(this.filesToScan)) {
			const { error } = await noTryAsync(async () => {
				await this.scanFile(
			  	fileObject.mediaPath,
			  	fileObject.mediaId,
				  fileObject.mediaStat)

				delete this.filesToScan[fileObject.mediaId]
			})
			if (error) { redoRetry = true }
	  }
	  this.retrying = false
	  if (redoRetry) {
			this.retryScan()
	  }
	}

	private async cleanDeleted() {
		this.logger.info('Media scanning: checking for dead media')
		const limit = 256
		let startkey: string | undefined = undefined
		while (true) {
			const deleted: Array<PouchDB.Core.PutDocument<{}>> = []

			const { rows } = await this.db.allDocs({
				include_docs: true,
				startkey,
				limit
			})
			await Promise.all(rows.map(async ({ doc }) => {
				const { error } = await noTryAsync(async () => {
					const mediaFolder = path.normalize(Array.isArray(this.settings.paths) ? this.settings.paths[0] : this.settings.paths)
					const mediaPath = path.normalize(doc.mediaPath)
					if (mediaPath.indexOf(mediaFolder) === 0 && await fileExists(doc.mediaPath)) {
						return
					}

					deleted.push({
						_id: doc._id,
						_rev: doc._rev,
						_deleted: true
					})
				})
				if (error) {
					this.logger.error(`Media scanning: failed `, error, doc)
				}
			}))

			await this.db.bulkDocs(deleted)

			if (rows.length < limit) {
				break
			}
			startkey = rows[rows.length - 1].doc._id
		}

		this.logger.info(`Media scanning: finished check for dead media`)
	}

	getCurrentScanId = () => this.scanning ? this.scanId : false
}
