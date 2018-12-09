import { EventEmitter } from 'events'
import * as Winston from 'winston'
import { literal } from '../lib/lib'

import { WorkStepStatus, WorkStepAction } from '../api'
import { FileWorkStep, WorkStep } from './workStep'
import { TrackedMediaItems } from '../mediaItemTracker'

export interface WorkResult {
	status: WorkStepStatus
	messages?: string[]
}

export class Worker extends EventEmitter {
	private _busy: boolean = false
	private _db: PouchDB.Database<WorkStep>
	private _trackedMediaItems: TrackedMediaItems

	constructor (db: PouchDB.Database<WorkStep>, tmi: TrackedMediaItems) {
		super()
		this._db = db
		this._trackedMediaItems = tmi
	}

	get busy (): boolean {
		return this._busy
	}

	async doWork (step: WorkStep): Promise<WorkResult> {
		const progressReportFailed = (e) => {
			this.emit('warn', `Worker could not report progress: ${e}`)
		}

		if (this._busy) throw new Error(`Busy worker was assigned to do "${step._id}"`)
		this._busy = true
		switch (step.action) {
			case WorkStepAction.COPY:
				return this.doCopy(step as any as FileWorkStep,
					(progress) => this.reportProgress(step, progress).then().catch(progressReportFailed))
					.then((result: WorkResult) => {
						this._busy = false
						return result
					})
					.catch((e) => this.failStep(e))
			case WorkStepAction.DELETE:
				return this.doDelete(step as any as FileWorkStep)
					.then((result: WorkResult) => {
						this._busy = false
						return result
					})
					.catch((e) => this.failStep(e))
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

	private async reportProgress (step: WorkStep, progress: number): Promise<void> {
		this.emit('debug', `${step._id}: Progress ${Math.round(progress * 100)}%`)
		return this._db.get(step._id).then((obj) => {
			(obj as WorkStep).progress = progress
			return this._db.put(obj).then(() => { })
		})
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
