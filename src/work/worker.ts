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

	async doWork (step: GeneralWorkStepDB): Promise<WorkResult> {
		const progressReportFailed = (e) => {
			this.emit('warn', `Worker could not report progress: ${e}`)
		}

		const unBusyAndFailStep = (p: Promise<WorkResult>) => {
			return p.then((result: WorkResult) => {
				this._busy = false
				return result
			})
			.catch((e) => this.failStep(e))
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

	private async failStep (reason: string): Promise<WorkResult> {
		return literal<WorkResult>({
			status: WorkStepStatus.ERROR,
			messages: [
				reason
			]
		})
	}

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
			return literal<WorkResult>({
				status: WorkStepStatus.ERROR
			})
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
			return literal<WorkResult>({
				status: WorkStepStatus.ERROR
			})
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
			return literal<WorkResult>({
				status: WorkStepStatus.ERROR
			})
		}
	}

	private async doCopy (step: FileWorkStep, reportProgress?: (progress: number) => void): Promise<WorkResult> {
		return step.target.handler.putFile(step.file, reportProgress).then(async () => {
			return this._trackedMediaItems.getById(step.file.name).then((tmi) => {
				if (tmi.targetStorageIds.indexOf(step.target.id) < 0) {
					tmi.targetStorageIds.push(step.target.id)
				}
				return this._trackedMediaItems.put(tmi)
			}).then(() => {
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
			}).catch((e) => {
				return this.failStep(e)
			})
		}, (e) => {
			return this.failStep(e)
		})
	}

	private async doDelete (step: FileWorkStep): Promise<WorkResult> {
		return step.target.handler.deleteFile(step.file).then(() => {
			return this._trackedMediaItems.getById(step.file.name).then((tmi) => {
				const idx = tmi.targetStorageIds.indexOf(step.target.id)
				if (idx >= 0) {
					tmi.targetStorageIds.splice(idx, 1)
				} else {
					this.emit('warn', `Asked to delete file from storage "${step.target.id}", yet file was not tracked at this location.`)
				}
				return this._trackedMediaItems.put(tmi)
			}, (e) => {
				if (e.status === 404) {
					this.emit('info', `File "${step.file.name}" to be deleted was already removed from tracking database`)
					return literal<WorkResult>({
						status: WorkStepStatus.DONE
					})
				} else {
					throw e
				}
			}).then(() => {
				return literal<WorkResult>({
					status: WorkStepStatus.DONE
				})
			}).catch((e) => {
				return this.failStep(e)
			})
		}, (e) => {
			return this.failStep(e)
		})
	}
}
