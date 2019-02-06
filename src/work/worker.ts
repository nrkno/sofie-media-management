import { EventEmitter } from 'events'
import { literal, LogEvents, getID } from '../lib/lib'

import { WorkStepStatus, WorkStepAction, DeviceSettings, WorkStep } from '../api'
import { GeneralWorkStepDB, FileWorkStep, WorkStepDB, ScannerWorkStep } from './workStep'
import { TrackedMediaItems } from '../mediaItemTracker'
import * as request from 'request-promise-native'

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
	private _db: PouchDB.Database<WorkStepDB>
	private _trackedMediaItems: TrackedMediaItems
	private _config: DeviceSettings

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
		return this._busy
	}
	/**
	 * Receive work from the Dispatcher
	 */
	async doWork (step: GeneralWorkStepDB): Promise<WorkResult> {
		const progressReportFailed = (e) => {
			this.emit('warn', `Worker could not report progress: ${e}`)
		}

		const unBusyAndFailStep = (p: Promise<WorkResult>) => {
			return p.then((result: WorkResult) => {
				this._busy = false
				return result
			})
			.catch((e) => {
				this._busy = false
				return this.failStep(e)
			})
		}

		if (this._busy) throw new Error(`Busy worker was assigned to do "${step._id}"`)
		this._busy = true
		switch (step.action) {
			case WorkStepAction.COPY:
				return unBusyAndFailStep(this.doCopy(step as FileWorkStep,
					(progress) => this.reportProgress(step, progress).then().catch(progressReportFailed)))
			case WorkStepAction.DELETE:
				return unBusyAndFailStep(this.doDelete(step as FileWorkStep))
			case WorkStepAction.GENERATE_METADATA:
				return unBusyAndFailStep(this.doGenerateMetadata(step as ScannerWorkStep))
			case WorkStepAction.GENERATE_PREVIEW:
				return unBusyAndFailStep(this.doGeneratePreview(step as ScannerWorkStep))
			case WorkStepAction.GENERATE_THUMBNAIL:
				return unBusyAndFailStep(this.doGenerateThumbnail(step as ScannerWorkStep))
			default:
				return Promise.resolve().then(() => {
					return this.failStep(`Worker could not recognize action: ${step.action}`)
				})
		}
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
		this.emit('debug', `${step._id}: Progress ${Math.round(progress * 100)}%`)
		return this._db.get(step._id).then((obj) => {
			(obj as WorkStep).progress = progress
			return this._db.put(obj).then(() => { })
		})
	}

	private async doGenerateThumbnail (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			let fileId = getID(step.file.name)
			if (step.target.options && step.target.options.mediaPath) {
				fileId = step.target.options.mediaPath + '/' + fileId
			}
			const res = await request(`http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/thumbnail/generate/${escapeUrlComponent(fileId)}`).promise()
			if (((res || '') as string).startsWith('202')) {
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
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
			let fileId = getID(step.file.name)
			if (step.target.options && step.target.options.mediaPath) {
				fileId = step.target.options.mediaPath + '/' + fileId
			}
			const res = await request(`http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/preview/generate/${escapeUrlComponent(fileId)}`).promise()
			if (((res || '') as string).startsWith('202')) {
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
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

	private async doGenerateMetadata (step: ScannerWorkStep): Promise<WorkResult> {
		try {
			let fileName = step.file.name.replace('\\', '/')
			if (step.target.options && step.target.options.mediaPath) {
				fileName = step.target.options.mediaPath + '/' + fileName
			}
			const res = await request(`http://${this._config.mediaScanner.host}:${this._config.mediaScanner.port}/media/scan/${escapeUrlComponent(fileName)}`).promise()
			if (((res || '') as string).startsWith('202')) {
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
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

	private async doCopy (step: FileWorkStep, reportProgress?: (progress: number) => void): Promise<WorkResult> {
		try {
			await step.target.handler.putFile(step.file, reportProgress)
			this.emit('debug', `Starting updating TMI on "${step.file.name}"`)
			try {
				await this._trackedMediaItems.upsert(step.file.name, (tmi) => {
					if (!tmi) throw new Error(`Item not tracked: ${step.file.name}`)
					if (tmi.targetStorageIds.indexOf(step.target.id) < 0) {
						tmi.targetStorageIds.push(step.target.id)
					}
					return tmi
				})
				this.emit('debug', `Finish updating TMI on "${step.file.name}"`)
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
			} catch (e) {
				this.emit('debug', `Failure updating TMI: ${e}`)
				return this.failStep(e)
			}
		} catch (e1) {
			return this.failStep(e1)
		}
	}

	private async doDelete (step: FileWorkStep): Promise<WorkResult> {
		try {
			await step.target.handler.deleteFile(step.file)
			try {
				try {
					await this._trackedMediaItems.upsert(step.file.name, (tmi) => {
						if (!tmi) throw new Error(`Item not tracked: ${step.file.name}`)
						const idx = tmi.targetStorageIds.indexOf(step.target.id)
						if (idx >= 0) {
							tmi.targetStorageIds.splice(idx, 1)
						} else {
							this.emit('warn', `Asked to delete file from storage "${step.target.id}", yet file was not tracked at this location.`)
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
