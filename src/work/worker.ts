import { EventEmitter } from 'events'
import { literal, LogEvents, getID, updateDB, getCurrentTime } from '../lib/lib'

import { WorkStepStatus, WorkStepAction, DeviceSettings, Time } from '../api'
import { GeneralWorkStepDB, FileWorkStep, WorkStepDB, ScannerWorkStep } from './workStep'
import { TrackedMediaItems, TrackedMediaItem } from '../mediaItemTracker'
import * as request from 'request-promise-native'
import { CancelHandler } from '../lib/cancelablePromise';

const escapeUrlComponent = encodeURIComponent

export interface WorkResult {
	status: WorkStepStatus
	messages?: string[]
}

/**
 * A worker is given a work-step, and will perform actions, using that step
 * The workers are kept by the dispatcher and given work from it
 */
export class Worker extends EventEmitter {
	private _busy: boolean = false
	private _warmingUp: boolean = false
	private _db: PouchDB.Database<WorkStepDB>
	private _trackedMediaItems: TrackedMediaItems
	private _config: DeviceSettings
	private _currentStep: GeneralWorkStepDB | undefined
	private _currentAbortHandler: (() => void) | undefined
	private _finishPromises: Array<Function> = []
	private _lastBeginStep: Time | undefined

	constructor (db: PouchDB.Database<WorkStepDB>, tmi: TrackedMediaItems, config: DeviceSettings) {
		super()
		this._db = db
		this._trackedMediaItems = tmi
		this._config = config
	}

	on (type: LogEvents, listener: (e: string) => void): this {
		return super.on(type, listener)
	}

	get busy (): boolean {
		return this._busy || this._warmingUp
	}
	get step (): GeneralWorkStepDB | undefined {
		return this._currentStep
	}
	get lastBeginStep (): Time | undefined {
		return this._busy ? this._lastBeginStep : undefined
	} 
	/**
	 * synchronous pre-step, to be called before doWork.
	 * run as an intent to start a work (soon)
	 */
	warmup () {
		if (this._warmingUp) throw new Error(`Worker is already warming up`)
		this._warmingUp = true
	}
	cooldown () {
		if (this._warmingUp) {
			this._warmingUp = false
		}
	}
	/**
	 * Receive work from the Dispatcher
	 */
	async doWork (step: GeneralWorkStepDB): Promise<WorkResult> {
		const progressReportFailed = (e) => {
			this.emit('warn', `Worker could not report progress`, e)
		}

		const unBusyAndFailStep = (p: Promise<WorkResult>) => {
			return p.then((result: WorkResult) => {
				this._notBusyAnymore()
				return result
			})
			.catch((e) => {
				this._notBusyAnymore()
				return this.failStep(e)
			})
		}

		if (!this._warmingUp) throw new Error(`Tried to start worker without warming up`)

		if (this._busy) throw new Error(`Busy worker was assigned to do "${step._id}"`)
		this._busy = true
		this._warmingUp = false
		this._currentStep = step
		this._lastBeginStep = getCurrentTime()
		this._currentAbortHandler = undefined

		switch (step.action) {
			case WorkStepAction.COPY:
				return unBusyAndFailStep(this.doCompositeCopy(step,
					(progress) => this.reportProgress(step, progress).then().catch(progressReportFailed),
					(onCancel) => this._currentAbortHandler = onCancel))
			case WorkStepAction.DELETE:
				return unBusyAndFailStep(this.doDelete(step))
			case WorkStepAction.GENERATE_METADATA:
				return unBusyAndFailStep(this.doGenerateAdvancedMetadata(step))
			case WorkStepAction.GENERATE_PREVIEW:
				return unBusyAndFailStep(this.doGeneratePreview(step))
			case WorkStepAction.GENERATE_THUMBNAIL:
				return unBusyAndFailStep(this.doGenerateThumbnail(step))
		}
	}
	/**
	 * Try to abort current working step.
	 * This method does not return any feedback on success or not,
	 * Instead use this.waitUntilFinished to determine if worker is done or not.
	 */
	tryToAbort () {
		if (this.busy && this.step && this._currentAbortHandler) {
			// Implement abort functions
			this._currentAbortHandler()
		}
	}
	/**
	 * Return a promise which will resolve when the current job is done
	 */
	waitUntilFinished (): Promise<void> {
		if (this._busy) {
			return new Promise((resolve) => {
				this._finishPromises.push(resolve)
			})
		} else {
			return Promise.resolve()
		}
	}
	private _notBusyAnymore () {
		this._busy = false
		this._finishPromises.forEach(fcn => {
			fcn()
		})
		this._finishPromises = []
	}
	/**
	 * Return a "failed" workResult
	 * @param reason
	 */
	private async failStep (reason: string): Promise<WorkResult> {
		this.emit('error', reason)
		return literal<WorkResult>({
			status: WorkStepStatus.ERROR,
			messages: [
				reason.toString()
			]
		})
	}
	/**
	 * Report on the progress of a work step
	 * @param step
	 * @param progress
	 */
	private async reportProgress (step: WorkStepDB, progress: number): Promise<void> {
		// this.emit('debug', `${step._id}: Progress ${Math.round(progress * 100)}%`)

		if (!this._busy) return // Don't report on progress unless we're busy

		return updateDB(this._db, step._id, (obj) => {
			const currentProgress = obj.progress || 0
			if (currentProgress < progress) {
				// this.emit('debug', `${step._id}: Higher progress won: ${currentProgress}`),
				obj.progress = progress
			}
			return obj
		})
		.then(() => {
			// nothing
		})
	}

	private async metaLoopUntilDone (name, uri) {
		// It was queued, we need to loop with a GET to see if it is done:
		let notDone = true
		let queryRes
		while (notDone) {
			queryRes = await request({
				method: 'GET',
				uri: uri
			}).promise()
			let responseString = ((queryRes || '') as string)
			if (responseString.startsWith(`202 ${name} OK`)) {
				notDone = false
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
			}
			if (responseString.startsWith('500') || responseString.startsWith('404')) {
				notDone = false
				return literal<WorkResult>({
					status: WorkStepStatus.ERROR,
					messages: [(queryRes + '')]
				})
			}
			// wait a bit, then retry
			if (responseString.startsWith(`203 ${name} IN PROGRESS`)) {
				await new Promise(resolve => {
					setTimeout(resolve, 1000)
				})
			}
		}
		return literal<WorkResult>({
			status: WorkStepStatus.ERROR,
			messages: [(queryRes + '')]
		})
	}

	private async doGenerateThumbnail (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			if (!this._config.mediaScanner.host) {
				return literal<WorkResult>({
					status: WorkStepStatus.SKIPPED,
					messages: [ 'Media-scanner host not set' ]
				})
			}
			let fileId = getID(step.file.name)
			if (step.target.options && step.target.options.mediaPath) {
				fileId = step.target.options.mediaPath + '/' + fileId
			}
			const res = await request({
				method: 'POST',
				uri: `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/thumbnail/generateAsync/${escapeUrlComponent(fileId)}`
			}).promise()
			const resString = ((res || '') as string)
			if (resString.startsWith('202') || resString.startsWith('203')) {
				return this.metaLoopUntilDone('THUMBNAIL GENERATE', `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/thumbnail/generateAsync/${escapeUrlComponent(fileId)}`)
			} else {
				return literal<WorkResult>({
					status: WorkStepStatus.ERROR,
					messages: [ (res + '') ]
				})
			}
		} catch (e) {
			return this.failStep(e)
		}
	}

	private async doGeneratePreview (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			if (!this._config.mediaScanner.host) {
				return literal<WorkResult>({
					status: WorkStepStatus.SKIPPED,
					messages: [ 'Media-scanner host not set' ]
				})
			}

			let fileId = getID(step.file.name)
			if (step.target.options && step.target.options.mediaPath) {
				fileId = step.target.options.mediaPath + '/' + fileId
			}
			const res = await request({
				method: 'POST',
				uri: `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/preview/generateAsync/${escapeUrlComponent(fileId)}`
			}).promise()
			const resString = ((res || '') as string)
			if (resString.startsWith('202') || resString.startsWith('203')) {
				return this.metaLoopUntilDone('PREVIEW GENERATE', `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/preview/generateAsync/${escapeUrlComponent(fileId)}`)
			} else {
				return literal<WorkResult>({
					status: WorkStepStatus.ERROR,
					messages: [ (res + '') ]
				})
			}
		} catch (e) {
			return this.failStep(e)
		}
	}

	private async doGenerateAdvancedMetadata (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			if (!this._config.mediaScanner.host) {
				return literal<WorkResult>({
					status: WorkStepStatus.SKIPPED,
					messages: ['Media-scanner host not set']
				})
			}
			let fileId = getID(step.file.name)
			if (step.target.options && step.target.options.mediaPath) {
				fileId = step.target.options.mediaPath + '/' + fileId
			}
			const res = await request({
				method: 'POST',
				uri: `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/metadata/generateAsync/${escapeUrlComponent(fileId)}`
			}).promise()
			const resString = ((res || '') as string)
			if (resString.startsWith('202') || resString.startsWith('203')) {
				return this.metaLoopUntilDone('METADATA', `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/metadata/generateAsync/${escapeUrlComponent(fileId)}`)
			} else {
				return literal<WorkResult>({
					status: WorkStepStatus.ERROR,
					messages: [(res + '')]
				})
			}
		} catch (e) {
			return this.failStep(e)
		}
	}

	private async doGenerateMetadata (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			if (!this._config.mediaScanner.host) {
				return literal<WorkResult>({
					status: WorkStepStatus.SKIPPED,
					messages: [ 'Media-scanner host not set' ]
				})
			}
			let fileName = step.file.name.replace('\\', '/')
			if (step.target.options && step.target.options.mediaPath) {
				fileName = step.target.options.mediaPath + '/' + fileName
			}
			const res = await request({
				method: 'POST',
				uri: `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/media/scanAsync/${escapeUrlComponent(fileName)}`
			}).promise()
			const resString = ((res || '') as string)
			if (resString.startsWith('202') || resString.startsWith('203')) {
				return this.metaLoopUntilDone('MEDIA INFO', `http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/media/scanAsync/${escapeUrlComponent(fileName)}`)
			} else {
				return literal<WorkResult>({
					status: WorkStepStatus.ERROR,
					messages: [ (res + '') ]
				})
			}
		} catch (e) {
			return this.failStep(e)
		}
	}

	private async doCompositeCopy (step: FileWorkStep, reportProgress?: (progress: number) => void, onCancel?: CancelHandler): Promise<WorkResult> {
		const copyResult = await this.doCopy(step, reportProgress, onCancel)
		// this is a composite step that can be only cancelled (for now) at the copy stage
		// so we need to unset the cancel handler ourselves
		this._currentAbortHandler = undefined
		if (copyResult.status === WorkStepStatus.DONE) {
			const metadataResult = await this.doGenerateMetadata(literal<ScannerWorkStep>({
				action: WorkStepAction.GENERATE_METADATA,
				file: step.file,
				target: step.target,
				status: WorkStepStatus.IDLE,
				priority: 1
			}))
			return literal<WorkResult>({
				status: metadataResult.status,
				messages: (copyResult.messages || []).concat(metadataResult.messages || [])
			})
		} else {
			return copyResult
		}
	}

	private doCopy (step: FileWorkStep, reportProgress?: (progress: number) => void, onCancel?: CancelHandler): Promise<WorkResult> {
		return new Promise((resolve) => {
			const p = step.target.handler.putFile(step.file, reportProgress)
			p.then(() => {
				this.emit('debug', `Starting updating TMI on "${step.file.name}"`)
				this._trackedMediaItems.upsert(step.file.name, (tmi?: TrackedMediaItem) => {
					// if (!tmi) throw new Error(`Item not tracked: ${step.file.name}`)
					if (tmi) {
						if (tmi.targetStorageIds.indexOf(step.target.id) < 0) {
							tmi.targetStorageIds.push(step.target.id)
						}
						return tmi
					}
					return undefined
				}).then(() => {
					this.emit('debug', `Finish updating TMI on "${step.file.name}"`)
					resolve(literal<WorkResult>({
						status: WorkStepStatus.DONE
					}))
				}).catch((e) => {
					this.emit('debug', `Failure updating TMI`, e)
					resolve(this.failStep(e))
				})
			}).catch((e1) => {
				resolve(this.failStep(e1))
			})

			if (onCancel) {
				onCancel(() => {
					p.cancel()
					this.emit('warn', `Canceled copy operation on "${step.file.name}"`)
				})
			}
		})
	}

	private async doDelete (step: FileWorkStep): Promise<WorkResult> {
		try {
			await step.target.handler.deleteFile(step.file)
			try {
				try {
					await this._trackedMediaItems.upsert(step.file.name, (tmi?: TrackedMediaItem) => {
						// if (!tmi) throw new Error(`Delete: Item not tracked: ${step.file.name}`)
						if (tmi) {
							const idx = tmi.targetStorageIds.indexOf(step.target.id)
							if (idx >= 0) {
								tmi.targetStorageIds.splice(idx, 1)
							} else {
								this.emit('warn', `Asked to delete file from storage "${step.target.id}", yet file was not tracked at this location.`)
							}
						}
						return tmi
					})
				} catch (e) {
					if (e.status === 404) {
						this.emit('info', `File "${step.file.name}" to be deleted was already removed from tracking database`)
						return literal<WorkResult>({
							status: WorkStepStatus.DONE
						})
					} else {
						throw e
					}
				}
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
			} catch (e1) {
				return this.failStep(e1)
			}
		} catch (e2) {
			return this.failStep(e2)
		}
	}
}
