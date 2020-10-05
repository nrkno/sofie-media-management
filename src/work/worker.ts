import { literal, getID, updateDB, getCurrentTime } from '../lib/lib'
import { LoggerInstance } from 'winston'
import {
	WorkStepStatus,
	WorkStepAction,
	DeviceSettings,
	Time,
	MediaObject,
	FieldOrder,
	Anomaly,
	Metadata,
	MediaInfo,
	StorageSettings
} from '../api'
import { GeneralWorkStepDB, FileWorkStep, WorkStepDB, ScannerWorkStep } from './workStep'
import { TrackedMediaItems, TrackedMediaItemDB } from '../mediaItemTracker'
import { CancelHandler } from '../lib/cancelablePromise'
import { noTryAsync } from 'no-try'
import * as path from 'path'
import { exec, spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs-extra'
import * as http from 'http'
import { MonitorQuantel } from '../monitors/quantel'
import quantelMetadataTransform from './quantelFormats'

export interface WorkResult {
	status: WorkStepStatus
	messages?: string[]
}

/** Used for sorting black frames and freeze frames. */
interface SortMeta {
	time: number
	type: 'start' | 'end'
	isBlack: boolean
}

/** Grouping of details created during a file stat. */
interface MediaFileDetails {
	mediaPath: string
	mediaStat: fs.Stats
	mediaId: string
}

const FixedQuantelStats = literal<fs.Stats>({
	isFile: () => false,
	isDirectory: () => false,
	isBlockDevice: () => false,
	isCharacterDevice: () => false,
	isSymbolicLink: () => false,
	isFIFO: () => false,
	isSocket: () => false,
	dev: 0,
	ino: 0,
	mode: 0,
	nlink: 0,
	uid: 0,
	gid: 0,
	rdev: 0,
	size: 0,
	blksize: 0,
	blocks: 0,
	atimeMs: 0,
	mtimeMs: 0,
	ctimeMs: 0,
	birthtimeMs: 0,
	atime: new Date(),
	mtime: new Date(),
	ctime: new Date(),
	birthtime: new Date()
})

/**
 * A worker is given a work-step, and will perform actions, using that step
 * The workers are kept by the dispatcher and given work from it
 */
export class Worker {
	private _busy: boolean = false
	private _warmingUp: boolean = false
	private _step: GeneralWorkStepDB | undefined
	private abortHandler: (() => void) | undefined
	private finishPromises: Array<Function> = []
	private _lastBeginStep: Time | undefined
	private ident: string
	private quantelMonitorArrival: ((qm: MonitorQuantel | undefined) => void) | undefined = undefined
	private quantelMonitorPromise: Promise<MonitorQuantel> | undefined = undefined

	constructor(
		private workStepDB: PouchDB.Database<WorkStepDB>,
		private mediaDB: PouchDB.Database<MediaObject>,
		private trackedMediaItems: TrackedMediaItems,
		private config: DeviceSettings,
		private logger: LoggerInstance,
		workerID: number
	) {
		this.ident = `Worker ${workerID}:`
	}

	get busy(): boolean {
		return this._busy || this._warmingUp
	}

	get step(): GeneralWorkStepDB | undefined {
		return this._step
	}

	get lastBeginStep(): Time | undefined {
		return this._busy ? this._lastBeginStep : undefined
	}

	setQuantelMonitor(monitor?: MonitorQuantel) {
		if (!this.quantelMonitorArrival) {
			if (monitor) {
				this.quantelMonitorPromise = Promise.resolve(monitor)
			}
		} else {
			this.quantelMonitorArrival(monitor)
		}
	}

	private async getQuantelMonitor(): Promise<MonitorQuantel> {
		if (this.quantelMonitorPromise === undefined) {
			this.quantelMonitorPromise = new Promise<MonitorQuantel>((resolve, reject) => {
				const timeout = setTimeout(() => {
					this.quantelMonitorPromise = undefined
					this.quantelMonitorArrival = undefined
					reject(`Worker: getQuantelMonitor: time out waiting for monitor`)
				}, 5000)
				this.quantelMonitorArrival = (qm: MonitorQuantel | undefined) => {
					clearTimeout(timeout)
					if (qm) {
						resolve(qm)
					} else {
						this.quantelMonitorPromise = undefined
						reject(new Error(`Worker: getQuantelMonitor: empty Quantel monitor passed in`))
					}
				}
			})
		}
		return this.quantelMonitorPromise
	}

	/**
	 * synchronous pre-step, to be called before doWork.
	 * run as an intent to start a work (soon)
	 */
	warmup() {
		if (this._warmingUp) throw new Error(`${this.ident} already warming up`)
		this._warmingUp = true
	}

	cooldown() {
		if (this._warmingUp) {
			this._warmingUp = false
		}
	}

	private async unBusyAndFailStep(p: Promise<WorkResult>) {
		const { result, error } = await noTryAsync(() => p)
		this.notBusyAnymore()
		return error ? this.failStep(error) : result
	}

	/**
	 *  Receive work from the Dispatcher
	 */
	async doWork(step: GeneralWorkStepDB): Promise<WorkResult> {
		const progressReportFailed = e => {
			this.logger.warn(`${this.ident} could not report progress`, e)
		}

		if (!this._warmingUp) throw new Error(`${this.ident} tried to start worker without warming up`)

		if (this._busy) throw new Error(`${this.ident} busy worker was assigned to do "${step._id}"`)
		this._busy = true
		this._warmingUp = false
		this._step = step
		this._lastBeginStep = getCurrentTime()
		this.abortHandler = undefined

		switch (step.action) {
			case WorkStepAction.COPY:
				return this.unBusyAndFailStep(
					this.doCompositeCopy(
						step,
						progress =>
							this.reportProgress(step, progress)
								.then()
								.catch(progressReportFailed),
						onCancel => (this.abortHandler = onCancel)
					)
				)
			case WorkStepAction.DELETE:
				return this.unBusyAndFailStep(this.doDelete(step))
			case WorkStepAction.SCAN:
				return this.unBusyAndFailStep(this.doGenerateMetadata(step))
			case WorkStepAction.GENERATE_METADATA:
				return this.unBusyAndFailStep(this.doGenerateAdvancedMetadata(step))
			case WorkStepAction.GENERATE_PREVIEW:
				return this.unBusyAndFailStep(this.doGeneratePreview(step))
			case WorkStepAction.GENERATE_THUMBNAIL:
				return this.unBusyAndFailStep(this.doGenerateThumbnail(step))
		}
	}

	/**
	 * Try to abort current working step.
	 * This method does not return any feedback on success or not,
	 * Instead use this.waitUntilFinished to determine if worker is done or not.
	 */
	tryToAbort() {
		if (this.busy && this.step && this.abortHandler) {
			// Implement abort functions
			this.abortHandler()
		}
	}

	/**
	 * Return a promise which will resolve when the current job is done
	 */
	waitUntilFinished(): Promise<void> {
		if (this._busy) {
			return new Promise(resolve => {
				this.finishPromises.push(resolve)
			})
		} else {
			return Promise.resolve()
		}
	}

	private notBusyAnymore() {
		this._busy = false
		this.finishPromises.forEach(fcn => {
			fcn()
		})
		this.finishPromises = []
	}

	/**
	 * Return a "failed" workResult
	 * @param reason
	 */
	private async failStep(reason: string | Error, action?: WorkStepAction, cause?: Error): Promise<WorkResult> {
		this.logger.error(
			`${this.ident}${action ? ' ' + action + ':' : ''} ${reason.toString()}`,
			cause ? cause : reason
		)
		return literal<WorkResult>({
			status: WorkStepStatus.ERROR,
			messages: [reason.toString()]
		})
	}

	/**
	 * Report on the progress of a work step
	 * @param step
	 * @param progress
	 */
	private async reportProgress(step: WorkStepDB, progress: number): Promise<void> {
		// this.emit('debug', `${step._id}: Progress ${Math.round(progress * 100)}%`)

		if (!this._busy) return // Don't report on progress unless we're busy
		progress = Math.max(0, Math.min(1, progress)) // sanitize progress value

		await noTryAsync(
			() =>
				updateDB(this.workStepDB, step._id, obj => {
					const currentProgress = obj.progress || 0
					if (currentProgress < progress) {
						// this.logger.debug(`Worker: ${step._id}: Higher progress won: ${currentProgress}`),
						obj.progress = progress
					}
					return obj
				}),
			error => this.logger.error(`Worker: error updating progress in database`, error)
		)
	}

	private async lookForFile(mediaGeneralId: string, config: StorageSettings): Promise<MediaFileDetails | false> {
		if (this.isQuantel(mediaGeneralId)) {
			return literal<MediaFileDetails>({
				mediaPath: mediaGeneralId,
				mediaId: mediaGeneralId,
				mediaStat: FixedQuantelStats
			})
		}
		const storagePath = (config.options && config.options.mediaPath) || ''
		const mediaPath = path.join(storagePath, mediaGeneralId)
		this.logger.debug(
			`${
				this.ident
			}: Media path is "${mediaPath}" with storagePath "${storagePath}" and relative "${path.relative(
				storagePath,
				mediaPath
			)}"`
		)
		const { error, result: mediaStat } = await noTryAsync(() => fs.stat(mediaPath))
		if (error) {
			return false
		}
		const mediaId = getID(path.relative(storagePath, mediaPath))
		return literal<MediaFileDetails>({
			mediaPath,
			mediaStat,
			mediaId
		})
	}

	private isQuantel(id: string): boolean {
		return typeof id === 'string' && id.toUpperCase().startsWith('QUANTEL:')
	}

	private async doGenerateThumbnail(step: ScannerWorkStep): Promise<WorkResult> {
		let fileId = getID(step.file.name)
		// if (step.target.options && step.target.options.mediaPath) {
		// 	fileId = step.target.options.mediaPath + '/' + fileId
		// }
		let { result: doc, error: getError } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError) {
			return this.failStep(`failed to retrieve media object with ID "${fileId}"`, step.action, getError)
		}

		const destPath = path.join(
			(this.config.paths && this.config.paths.resources) || '',
			(this.config.thumbnails && this.config.thumbnails.folder) || 'thumbs',
			`${doc._id.replace(/:/gi, '_')}.jpg`
		)
		const tmpPath = destPath.slice(0, -4) + '.new.jpg'
		await fs.mkdirp(path.dirname(tmpPath))

		if (this.isQuantel(doc.mediaId)) {
			const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
			if (qmError) {
				return this.failStep(`Quantel media but no Quantel connection details for "${fileId}"`, step.action)
			}
			const { result: stillUrl, error: urlError } = await noTryAsync(() =>
				qm.toStillUrl(doc.mediaId, (this.config.thumbnails && this.config.thumbnails.width) || 256)
			)
			if (urlError) {
				return this.failStep(`Could not resolve Quantel ID to stream URL`, step.action, urlError)
			}
			// TODO make an request for the thumbnail
			const { error: httpError } = await noTryAsync(
				() =>
					new Promise((resolve, reject) => {
						const thumbStream = fs.createWriteStream(tmpPath)
						http.get(stillUrl, res => {
							if (res.statusCode !== 200) {
								return reject(new Error(`Expected status code of 200, got ${res.statusCode}`))
							}
							res.pipe(thumbStream)
							res.on('error', reject)
							res.on('close', resolve)
						}).on('error', reject)
					})
			)
			if (httpError) {
				return this.failStep(
					`external request to HTTP transformer to generate thumbnail for "${fileId}" failed`,
					step.action,
					httpError
				)
			}
		} else {
			const args = [
				// TODO (perf) Low priority process?
				(this.config.paths && this.config.paths.ffmpeg) || process.platform === 'win32'
					? 'ffmpeg.exe'
					: 'ffmpeg',
				'-hide_banner',
				`-i "${doc.mediaPath}"`,
				'-frames:v 1',
				`-vf thumbnail,scale=${(this.config.thumbnails && this.config.thumbnails.width) || 256}:` +
					`${(this.config.thumbnails && this.config.thumbnails.height) || -1}`,
				'-threads 1',
				`"${tmpPath}"`
			]

			const { error: execError } = await noTryAsync(
				() =>
					new Promise((resolve, reject) => {
						exec(args.join(' '), (err, stdout, stderr) => {
							this.logger.debug(`Worker: thumbnail generate: output (stdout, stderr)`, stdout, stderr)
							if (err) {
								return reject(err)
							}
							resolve()
						})
					})
			)
			if (execError) {
				return this.failStep(
					`external process to generate thumbnail for "${fileId}" failed`,
					step.action,
					execError
				)
			}
			this.logger.info(`Worker: thumbnail generate: generated thumbnail for "${fileId}" at path "${tmpPath}"`)
		} // Not a Quantel clip

		const { result: thumbStat, error: statError } = await noTryAsync(() => fs.stat(tmpPath))
		if (statError) {
			return this.failStep(`failed to stat generated thumbmail for "${fileId}"`, step.action, statError)
		}

		const { error: renameError } = await noTryAsync(() => fs.rename(tmpPath, destPath))
		if (renameError) {
			return this.failStep(
				`failed to remname tmp file from "${tmpPath}" to "${destPath}"`,
				step.action,
				renameError
			)
		}

		// Read document again ... might have been updated while we were busy working
		let { result: doc2, error: getError2 } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError2) {
			return this.failStep(
				`after work, failed to retrieve media object with ID "${fileId}"`,
				step.action,
				getError2
			)
		}

		doc2.thumbSize = thumbStat.size
		doc2.thumbTime = thumbStat.mtime.getTime()
		doc2.thumbPath = destPath.replace(/\\/gi, '/')

		const { error: putError } = await noTryAsync(() => this.mediaDB.put(doc2))
		if (putError) {
			return this.failStep(`failed to write thumbnail details to database for "${fileId}"`, step.action, putError)
		}

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}

	private async doGeneratePreview(step: ScannerWorkStep): Promise<WorkResult> {
		let fileId = getID(step.file.name)
		// if (step.target.options && step.target.options.mediaPath) {
		// 	fileId = step.target.options.mediaPath + '/' + fileId
		// }
		let { result: doc, error: getError } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError) {
			return this.failStep(`failed to retrieve media object with ID "${fileId}"`, step.action, getError)
		}
		const destPath = path.join(
			(this.config.paths && this.config.paths.resources) || '',
			(this.config.previews && this.config.previews.folder) || 'previews',
			`${doc._id.replace(/:/gi, '_')}.webm`
		)
		const tmpPath = destPath + '.new'

		if (doc.previewTime === doc.mediaTime && (await fs.pathExists(destPath))) {
			this.logger.debug(
				`Worker: generate preview: not regenerating preview at "${destPath}" as, by timestamp, it already exists`
			)
			return literal<WorkResult>({
				status: WorkStepStatus.DONE
			})
		}

		const args = ['-hide_banner', '-y', '-threads 1']
		if (this.isQuantel(doc.mediaId)) {
			const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
			if (qmError) {
				return this.failStep(
					`Quantel media but no Quantel connection details for "${fileId}"`,
					step.action,
					qmError
				)
			}
			const { result: hlsUrl, error: urlError } = await noTryAsync(() => qm.toStreamUrl(doc.mediaId))
			if (urlError) {
				return this.failStep(`Could not resolve Quantel ID to stream URL`, step.action, urlError)
			}
			args.push('-seekable 0')
			args.push(`-i "${hlsUrl}"`)
		} else {
			args.push(`-i "${doc.mediaPath}"`)
		}
		args.push('-f', 'webm')
		args.push('-an')
		args.push('-c:v', 'libvpx')
		args.push('-b:v', (this.config.previews && this.config.previews.bitrate) || '40k')
		args.push('-auto-alt-ref 0')
		args.push(
			`-vf scale=${(this.config.previews && this.config.previews.width) || 190}:` +
				`${(this.config.previews && this.config.previews.height) || -1}`
		)
		args.push('-deadline realtime')
		args.push(`"${tmpPath}"`)

		await fs.mkdirp(path.dirname(tmpPath))
		this.logger.info(`Worker: preview generate: starting preview generation for "${fileId}" at path "${tmpPath}"`)

		let resolver: (v?: any) => void
		let rejector: (reason?: any) => void
		let generating = () =>
			new Promise((resolve, reject) => {
				resolver = resolve
				rejector = reject
				let previewProcess = spawn(
					(this.config.paths && this.config.paths.ffmpeg) || process.platform === 'win32'
						? 'ffmpeg.exe'
						: 'ffmpeg',
					args,
					{ shell: true }
				)
				previewProcess.stdout.on('data', data => {
					this.logger.debug(`Worker: preview generate: stdout for "${fileId}"`, data.toString())
				})
				previewProcess.stderr.on('data', data => {
					this.logger.debug(`Worker: preview generate: stderr for "${fileId}"`, data.toString())
				})
				previewProcess.on('close', code => {
					if (code === 0) {
						resolver()
					} else {
						rejector(
							new Error(
								`Worker: preview generate: ffmpeg process with pid "${previewProcess.pid}" exited with code "${code}"`
							)
						)
					}
				})
			})
		const { error: generateError } = await noTryAsync(generating)
		if (generateError) {
			return this.failStep(`error while generating preview for "${fileId}"`, step.action, generateError)
		}
		this.logger.info(`Worker: preview generate: generated preview for "${fileId}" at path "${tmpPath}"`)

		const { result: previewStat, error: statError } = await noTryAsync(() => fs.stat(tmpPath))
		if (statError) {
			return this.failStep(
				`failed to read file stats for "${fileId}" at path "${tmpPath}"`,
				step.action,
				statError
			)
		}

		const { error: renameError } = await noTryAsync(() => fs.rename(tmpPath, destPath))
		if (renameError) {
			return this.failStep(
				`failed to remname tmp file from "${tmpPath}" to "${destPath}"`,
				step.action,
				renameError
			)
		}

		// Read document again ... might have been updated while we were busy working
		let { result: doc2, error: getError2 } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError2) {
			return this.failStep(
				`after work, failed to retrieve media object with ID "${fileId}"`,
				step.action,
				getError2
			)
		}

		doc2.previewSize = previewStat.size
		doc2.previewTime = doc.mediaTime
		doc2.previewPath = destPath

		const { error: putError } = await noTryAsync(() => this.mediaDB.put(doc2))
		if (putError) {
			return this.failStep(`failed to write preview details to database for "${fileId}"`, step.action, putError)
		}

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}

	private static readonly fieldRegex = /Multi frame detection: TFF:\s+(\d+)\s+BFF:\s+(\d+)\s+Progressive:\s+(\d+)/

	private async getFieldOrder(doc: MediaObject): Promise<FieldOrder> {
		if (this.config.metadata && !this.config.metadata.fieldOrder) {
			return FieldOrder.Unknown
		}

		const args = [
			// TODO (perf) Low priority process?
			(this.config.paths && this.config.paths.ffmpeg) || process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
			'-hide_banner',
			'-filter:v',
			'idet',
			'-frames:v',
			(this.config.metadata && this.config.metadata.fieldOrderScanDuration) || 200,
			'-an',
			'-f',
			'rawvideo',
			'-y',
			process.platform === 'win32' ? 'NUL' : '/dev/null'
		]
		if (this.isQuantel(doc.mediaId)) {
			const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
			if (qmError) {
				throw new Error(`Quantel media but no Quantel connection details for "${doc.mediaId}"`)
			}
			const { result: hlsUrl, error: urlError } = await noTryAsync(() => qm.toStreamUrl(doc.mediaId))
			if (urlError) {
				throw new Error(`Could not resolve Quantel ID to stream URL: ${urlError.message}`)
			}
			args.push('-seekable 0')
			args.push(`-i "${hlsUrl}"`)
		} else {
			args.push(`-i "${doc.mediaPath}"`)
		}

		const { error: execError, result } = await noTryAsync(
			() =>
				new Promise<string>((resolve, reject) => {
					exec(args.join(' '), (err, stdout, stderr) => {
						this.logger.debug(`Worker: field order detect: output (stdout, stderr)`, stdout, stderr)
						if (err) {
							return reject(err)
						}
						resolve(stderr)
					})
				})
		)
		if (execError) {
			this.logger.error(
				`${this.ident}: external process to detect field order for "${doc.mediaPath}" failed`,
				execError
			)
			return FieldOrder.Unknown
		}
		this.logger.info(`Worker: field order detect: generated field order for "${doc.mediaPath}"`)

		const res = Worker.fieldRegex.exec(result)
		if (res === null) {
			return FieldOrder.Unknown
		}

		const tff = parseInt(res[1])
		const bff = parseInt(res[2])
		const fieldOrder = tff <= 10 && bff <= 10 ? FieldOrder.Progressive : tff > bff ? FieldOrder.TFF : FieldOrder.BFF

		return fieldOrder
	}

	private static readonly sceneRegex = /Parsed_showinfo_(.*)pts_time:([\d.]+)\s+/g
	private static readonly blackDetectRegex = /(black_start:)(\d+(.\d+)?)( black_end:)(\d+(.\d+)?)( black_duration:)(\d+(.\d+))?/g
	private static readonly freezeDetectStart = /(lavfi\.freezedetect\.freeze_start: )(\d+(.\d+)?)/g
	private static readonly freezeDetectDuration = /(lavfi\.freezedetect\.freeze_duration: )(\d+(.\d+)?)/g
	private static readonly freezeDetectEnd = /(lavfi\.freezedetect\.freeze_end: )(\d+(.\d+)?)/g

	private async getMetadata(doc: MediaObject): Promise<Metadata> {
		const metaconf = this.config.metadata
		if (!metaconf || (!metaconf.scenes && !metaconf.freezeDetection && !metaconf.blackDetection)) {
			this.logger.debug(
				`Worker: get metadata: not generating stream metadata: ${metaconf} ${!metaconf!.scenes &&
					!metaconf!.freezeDetection &&
					!metaconf!.blackDetection}`
			)
			return {}
		}

		if (!doc.mediainfo || !doc.mediainfo.format || !doc.mediainfo.format.duration) {
			throw new Error('Worker: get metadata: running getMetadata requires the presence of basic file data first.')
		}

		let filterString = ''
		if (metaconf.blackDetection) {
			if (metaconf.blackDuration && metaconf.blackDuration?.endsWith('s')) {
				metaconf.blackDuration = metaconf.blackDuration.slice(0, -1)
			}
			filterString +=
				`blackdetect=d=${metaconf.blackDuration || '2.0'}:` +
				`pic_th=${metaconf.blackRatio || 0.98}:` +
				`pix_th=${metaconf.blackThreshold || 0.1}`
		}

		if (metaconf.freezeDetection) {
			if (filterString) {
				filterString += ','
			}
			filterString += `freezedetect=n=${metaconf.freezeNoise || 0.001}:` + `d=${metaconf.freezeDuration || '2s'}`
		}

		if (metaconf.scenes) {
			if (filterString) {
				filterString += ','
			}
			filterString += `"select='gt(scene,${metaconf.sceneThreshold || 0.4})',showinfo"`
		}

		const args = ['-hide_banner']
		if (this.isQuantel(doc.mediaId)) {
			const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
			if (qmError) {
				throw new Error(`Quantel media but no Quantel connection details for "${doc.mediaId}"`)
			}
			const { result: hlsUrl, error: urlError } = await noTryAsync(() => qm.toStreamUrl(doc.mediaId))
			if (urlError) {
				throw new Error(`Could not resolve Quantel ID to stream URL: ${urlError.message}`)
			}
			args.push('-seekable 0')
			args.push(`-i "${hlsUrl}"`)
		} else {
			args.push(`-i "${doc.mediaPath}"`)
		}
		args.push('-filter:v', filterString)
		args.push('-an')
		args.push('-f null')
		args.push('-threads 1')
		args.push('-')

		let infoProcess: ChildProcessWithoutNullStreams = spawn(
			(this.config.paths && this.config.paths.ffmpeg) || process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
			args,
			{ shell: true }
		)
		let [scenes, freezes, blacks] = [[] as Array<number>, [] as Array<Anomaly>, [] as Array<Anomaly>]
		// TODO current frame is not read?
		// let currentFrame = 0

		// infoProcess.stdout.on('data', () => { lastProgressReportTimestamp = new Date() })
		infoProcess.stderr.on('data', (data: any) => {
			let stringData = data.toString()
			// this.logger.debug(`Worker: get metadata: received stderr "${stringData}"`)
			if (typeof stringData !== 'string') return
			let frameMatch = stringData.match(/^frame= +\d+/)
			if (frameMatch) {
				// currentFrame = Number(frameMatch[0].replace('frame=', ''))
				return
			}

			let res: RegExpExecArray | null
			while ((res = Worker.sceneRegex.exec(stringData)) !== null) {
				scenes.push(parseFloat(res[2]))
			}

			while ((res = Worker.blackDetectRegex.exec(stringData)) !== null) {
				blacks.push(
					literal<Anomaly>({
						start: parseFloat(res[2]),
						duration: parseFloat(res[8]),
						end: parseFloat(res[5])
					})
				)
			}

			while ((res = Worker.freezeDetectStart.exec(stringData)) !== null) {
				freezes.push(
					literal<Anomaly>({
						start: parseFloat(res[2]),
						duration: 0.0,
						end: 0.0
					})
				)
			}

			let i = 0
			while ((res = Worker.freezeDetectDuration.exec(stringData)) !== null) {
				freezes[i++].duration = parseFloat(res[2])
			}

			i = 0
			while ((res = Worker.freezeDetectEnd.exec(stringData)) !== null) {
				freezes[i++].end = parseFloat(res[2])
			}
		})

		let resolver: (m: Metadata) => void
		let rejecter: (err: Error) => void

		const metaPromise = new Promise<Metadata>((resolve, reject) => {
			resolver = resolve
			rejecter = reject
		})

		infoProcess.on('close', code => {
			if (code === 0) {
				// success
				// if freeze frame is the end of video, it is not detected fully
				if (
					freezes[freezes.length - 1] &&
					!freezes[freezes.length - 1].end &&
					doc.mediainfo &&
					doc.mediainfo.format &&
					typeof doc.mediainfo.format.duration === 'number'
				) {
					freezes[freezes.length - 1].end = doc.mediainfo.format.duration
					freezes[freezes.length - 1].duration =
						doc.mediainfo.format.duration - freezes[freezes.length - 1].start
				}
				this.logger.debug(
					`Worker: get metadata: completed metadata analysis: scenes ${scenes ? scenes.length : 0}, freezes ${
						freezes ? freezes.length : 0
					}, blacks ${blacks ? blacks.length : 0}`
				)
				resolver({ scenes, freezes, blacks })
			} else {
				this.logger.error(`Worker: get metadata: FFmpeg failed with code ${code}`)
				rejecter(new Error(`Worker: get metadata: FFmpeg failed with code ${code}`))
			}
		})

		return metaPromise
	}

	private static sortBlackFreeze(tl: Array<SortMeta>): Array<SortMeta> {
		return tl.sort((a, b) => {
			if (a.time > b.time) {
				return 1
			} else if (a.time === b.time) {
				if ((a.isBlack && b.isBlack) || !(a.isBlack || b.isBlack)) {
					return 0
				} else {
					if (a.isBlack && a.type === 'start') {
						return 1
					} else if (a.isBlack && a.type === 'end') {
						return -1
					} else {
						return 0
					}
				}
			} else {
				return -1
			}
		})
	}

	private static updateFreezeStartEnd(tl: Array<SortMeta>): Array<Anomaly> {
		let freeze: Anomaly | undefined
		let interruptedFreeze = false
		let freezes: Array<Anomaly> = []
		const startFreeze = (t: number): void => {
			freeze = { start: t, duration: -1, end: -1 }
		}
		const endFreeze = (t: number): void => {
			if (freeze && t === freeze.start) {
				freeze = undefined
				return
			}
			if (!freeze) return
			freeze.end = t
			freeze.duration = t - freeze.start
			freezes.push(freeze)
			freeze = undefined
		}

		for (const ev of tl) {
			if (ev.type === 'start') {
				if (ev.isBlack) {
					if (freeze) {
						interruptedFreeze = true
						endFreeze(ev.time)
					}
				} else {
					startFreeze(ev.time)
				}
			} else {
				if (ev.isBlack) {
					if (interruptedFreeze) {
						startFreeze(ev.time)
						interruptedFreeze = false
					}
				} else {
					if (freeze) {
						endFreeze(ev.time)
					} else {
						const freeze = freezes[freezes.length - 1]
						if (freeze) {
							freeze.end = ev.time
							freeze.duration = ev.time - freeze.start
							interruptedFreeze = false
						}
					}
				}
			}
		}
		return freezes
	}

	private async doGenerateAdvancedMetadata(step: ScannerWorkStep): Promise<WorkResult> {
		let fileId = getID(step.file.name)
		// if (step.target.options && step.target.options.mediaPath) {
		// 	fileId = step.target.options.mediaPath + '/' + fileId
		// }
		let { result: doc, error: getError } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError) {
			return this.failStep(`failed to retrieve media object with ID "${fileId}"`, step.action, getError)
		}

		const { result: fieldOrder, error: foError } = await noTryAsync(() => this.getFieldOrder(doc))
		if (foError) {
			return this.failStep(
				`Unable to determine field order for media object with ID "${fileId}"`,
				step.action,
				foError
			)
		}
		const { result: metadata, error: mdError } = await noTryAsync(() => this.getMetadata(doc))
		if (mdError) {
			return this.failStep(`Unable to get metadata for media object with ID "${fileId}"`, step.action, mdError)
		}

		if (this.config.metadata && this.config.metadata.mergeBlacksAndFreezes) {
			if (metadata.blacks && metadata.blacks.length && metadata.freezes && metadata.freezes.length) {
				// blacks are subsets of freezes, so we can remove the freeze frame warnings during a black
				// in order to do this we create a linear timeline:
				let tl: Array<SortMeta> = []
				for (const black of metadata.blacks) {
					tl.push({ time: black.start, type: 'start', isBlack: true })
					tl.push({ time: black.end, type: 'end', isBlack: true })
				}
				for (const freeze of metadata.freezes) {
					tl.push({ time: freeze.start, type: 'start', isBlack: false })
					tl.push({ time: freeze.end, type: 'end', isBlack: false })
				}
				// then we sort it for time, if black & freeze start at the same time make sure black is inside the freeze
				tl = Worker.sortBlackFreeze(tl)

				// now we add freezes that aren't coinciding with blacks
				metadata.freezes = Worker.updateFreezeStartEnd(tl)
			}
		}

		// Read document again ... might have been updated while we were busy working
		let { result: doc2, error: getError2 } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError2) {
			return this.failStep(
				`after work, failed to retrieve media object with ID "${fileId}"`,
				step.action,
				getError2
			)
		}

		doc2.mediainfo = Object.assign(
			doc2.mediainfo,
			literal<MediaInfo>({
				name: doc2._id,
				// path: doc2.mediaPath, Error found with typings. These fields do not exist on MediaInfo
				// size: doc.mediaSize,
				// time: doc.mediaTime,

				field_order: fieldOrder,
				scenes: metadata.scenes,
				freezes: metadata.freezes,
				blacks: metadata.blacks
			})
		)

		const { error: putError } = await noTryAsync(() => this.mediaDB.put(doc2))
		if (putError) {
			return this.failStep(`failed to write media information to database for "${fileId}"`, step.action, putError)
		}

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}

	private async doGenerateMetadata(step: ScannerWorkStep): Promise<WorkResult> {
		let fileId = getID(step.file.name)
		// if (step.target.options && step.target.options.mediaPath) {
		// 	fileId = step.target.options.mediaPath + '/' + fileId
		// }
		let docExists = true
		let { result: doc, error: getError } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
		if (getError) {
			docExists = false
			if (this.isQuantel(fileId)) {
				doc = literal<MediaObject>({
					_id: fileId,
					_rev: '',
					mediaId: fileId,
					mediaPath: step.file.name,
					mediaSize: 0,
					mediaTime: Date.now(),
					thumbSize: 0,
					thumbTime: 0,
					cinf: '',
					tinf: ''
				})
			} else {
				const mediaFileDetails = await this.lookForFile(step.file.name, step.target)
				if (mediaFileDetails === false)
					return this.failStep(
						`failed to locate media object file with ID "${fileId}" at path "${step.target.options &&
							step.target.options.mediaPath}"`,
						step.action
					)

				doc = literal<MediaObject>({
					_id: mediaFileDetails.mediaId,
					_rev: '',
					mediaId: mediaFileDetails.mediaId,
					mediaPath: mediaFileDetails.mediaPath,
					mediaSize: mediaFileDetails.mediaStat.size,
					mediaTime: mediaFileDetails.mediaStat.mtime.getTime(),
					thumbSize: 0,
					thumbTime: 0,
					cinf: '',
					tinf: ''
				})
			}
		}

		let probeData: any = {}
		if (this.isQuantel(doc.mediaId)) {
			// Due to issues using ffprobe with the transformer, this is generated based on format code and frames
			const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
			if (qmError) {
				return this.failStep(
					`Quantel media but no Quantel connection details for "${doc.mediaId}"`,
					step.action,
					qmError
				)
			}
			const { result: clipData, error: detailError } = await noTryAsync(() => qm.getClipDetails(doc.mediaId))
			if (detailError) {
				return this.failStep(
					`Could not retrieve clip details: ${detailError.message}`,
					step.action,
					detailError
				)
			}
			if (clipData === null) {
				return this.failStep(`Could not find clips details for ${doc.mediaId}`, step.action)
			}
			probeData = quantelMetadataTransform(clipData)
		} else {
			const args = [
				// TODO (perf) Low priority process?
				(this.config.paths && this.config.paths.ffprobe) || process.platform === 'win32'
					? 'ffprobe.exe'
					: 'ffprobe',
				'-hide_banner',
				`-i "${doc.mediaPath}"`,
				'-show_streams',
				'-show_format',
				'-print_format',
				'json'
			]

			const { result: probeOutput, error: execError } = await noTryAsync(
				() =>
					new Promise<any>((resolve, reject) => {
						exec(args.join(' '), (err, stdout, stderr) => {
							this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
							if (err) {
								return reject(err)
							}
							const json: any = JSON.parse(stdout)
							if (!json.streams || !json.streams[0]) {
								return reject(new Error('not media'))
							}
							resolve(json)
						})
					})
			)
			if (execError) {
				return this.failStep(
					`external process to generate metadata for "${fileId}" failed`,
					step.action,
					execError
				)
			}
			probeData = probeOutput
		}
		this.logger.info(`Worker: metadata generate: generated metadata for "${fileId}"`)
		this.logger.debug(`Worker: metadata generate: generated metadata details`, probeData)

		let newInfo = literal<MediaInfo>({
			name: this.isQuantel(doc.mediaId) ? probeData.name : doc._id,
			//path: doc.mediaPath,
			//size: doc.mediaSize,
			//time: doc.mediaTime,
			// type,
			// field_order: FieldOrder.Unknown,
			// scenes: [],
			// freezes: [],
			// blacks: [],

			streams: probeData.streams.map((s: any) => ({
				codec: {
					long_name: s.codec_long_name,
					type: s.codec_type,
					time_base: s.codec_time_base,
					tag_string: s.codec_tag_string,
					is_avc: s.is_avc
				},

				// Video
				width: s.width,
				height: s.height,
				sample_aspect_ratio: s.sample_aspect_ratio,
				display_aspect_ratio: s.display_aspect_ratio,
				pix_fmt: s.pix_fmt,
				bits_per_raw_sample: s.bits_per_raw_sample,

				// Audio
				sample_fmt: s.sample_fmt,
				sample_rate: s.sample_rate,
				channels: s.channels,
				channel_layout: s.channel_layout,
				bits_per_sample: s.bits_per_sample,

				// Common
				time_base: s.time_base,
				start_time: s.start_time,
				duration_ts: s.duration_ts,
				duration: s.duration,

				bit_rate: s.bit_rate,
				max_bit_rate: s.max_bit_rate,
				nb_frames: s.nb_frames
			})),
			format: {
				name: probeData.format.format_name,
				long_name: probeData.format.format_long_name,
				// size: probeData.format.time, carried at a higher level

				start_time: probeData.format.start_time,
				duration: probeData.format.duration,
				bit_rate: probeData.format.bit_rate,
				max_bit_rate: probeData.format.max_bit_rate
			}
		})

		if (this.isQuantel(doc.mediaId)) {
			const mediaSize = parseInt(probeData.format.size)
			doc.mediaSize = isNaN(mediaSize) ? 0 : mediaSize
			doc.mediaTime = Date.parse(probeData.format.tags.modification_date)
			this.logger.debug(`Worker: metadata generate: new info size is ${mediaSize}`)
		}

		// Read document again ... might have been updated while we were busy working
		if (docExists) {
			let { result: doc2, error: getError2 } = await noTryAsync(() => this.mediaDB.get<MediaObject>(fileId))
			if (getError2) {
				return this.failStep(
					`after work, failed to retrieve media object with ID "${fileId}"`,
					step.action,
					getError2
				)
			}
			doc = doc2
		}
		doc.mediainfo = Object.assign(doc.mediainfo || {}, newInfo)
		this.logger.debug(`Worker: media clip is`, doc)

		const { error: putError, result: putResult } = await noTryAsync(() => this.mediaDB.put(doc))
		if (putError) {
			return this.failStep(`failed to write metadata to database for "${fileId}"`, step.action, putError)
		}
		this.logger.debug(`Worker: metadata generate: put result is`, putResult)

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}

	private async doCompositeCopy(
		step: FileWorkStep,
		reportProgress?: (progress: number) => void,
		onCancel?: CancelHandler
	): Promise<WorkResult> {
		const copyResult = await this.doCopy(step, reportProgress, onCancel)
		// this is a composite step that can be only cancelled (for now) at the copy stage
		// so we need to unset the cancel handler ourselves
		this.abortHandler = undefined
		if (copyResult.status === WorkStepStatus.DONE) {
			const metadataResult = await this.doGenerateMetadata(
				literal<ScannerWorkStep>({
					action: WorkStepAction.GENERATE_METADATA,
					file: step.file,
					target: step.target,
					status: WorkStepStatus.IDLE,
					priority: 1
				})
			)
			return literal<WorkResult>({
				status: metadataResult.status,
				messages: (copyResult.messages || []).concat(metadataResult.messages || [])
			})
		} else {
			return copyResult
		}
	}

	private async doCopy(
		step: FileWorkStep,
		reportProgress?: (progress: number) => void,
		onCancel?: CancelHandler
	): Promise<WorkResult> {
		const { error: putFileError } = await noTryAsync(() => {
			const p = step.target.handler.putFile(step.file, reportProgress)
			if (onCancel) {
				onCancel(() => {
					p.cancel()
					this.logger.warn(`${this.ident}: canceled copy operation on "${step.file.name}"`)
				})
			}
			return p
		})
		if (putFileError) {
			return this.failStep(`error copying file "${step.file.name}"`, step.action, putFileError)
		}

		this.logger.debug(`${this.ident} starting updating TMI on "${step.file.name}"`)
		const { error: upsertError } = await noTryAsync(() =>
			this.trackedMediaItems.upsert(step.file.name, (tmi?: TrackedMediaItemDB) => {
				// if (!tmi) throw new Error(`Item not tracked: ${step.file.name}`)
				if (tmi) {
					if (tmi.targetStorageIds.indexOf(step.target.id) < 0) {
						tmi.targetStorageIds.push(step.target.id)
					}
					return tmi
				}
				return undefined
			})
		)
		if (upsertError) {
			return this.failStep(`failure updating TMI for "${step.file.name}"`, step.action, upsertError)
		}
		this.logger.debug(`${this.ident} finish updating TMI on "${step.file.name}"`)

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}

	private async doDelete(step: FileWorkStep): Promise<WorkResult> {
		const { error: deleteError } = await noTryAsync(() => step.target.handler.deleteFile(step.file))
		if (deleteError) {
			return this.failStep(`failed to delete "${step.file.name}"`, step.action, deleteError)
		}

		const { error: upsertError } = await noTryAsync(() =>
			this.trackedMediaItems.upsert(step.file.name, (tmi?: TrackedMediaItemDB) => {
				// if (!tmi) throw new Error(`Item not tracked: ${step.file.name}`)
				if (tmi) {
					const idx = tmi.targetStorageIds.indexOf(step.target.id)
					if (idx >= 0) {
						tmi.targetStorageIds.splice(idx, 1)
					} else {
						this.logger.warn(
							`${this.ident}: asked to delete file from storage "${step.target.id}", yet file was not tracked at this location.`
						)
					}
				}
				return tmi
			})
		)
		if (upsertError) {
			if ((upsertError as any).status && (upsertError as any).status === 404) {
				this.logger.info(
					`${this.ident}: file "${step.file.name}" to be deleted was already removed from tracking database`
				)
			} else {
				return this.failStep(`failure updating TMI for copy of "${step.file.name}"`, step.action, upsertError)
			}
		}
		this.logger.debug(`${this.ident} finish updating TMI after delete of "${step.file.name}"`)

		return literal<WorkResult>({
			status: WorkStepStatus.DONE
		})
	}
}
