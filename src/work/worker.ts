import * as Winston from 'winston'
import { literal } from '../lib/lib'

import { WorkStepStatus, WorkStepAction } from '../api'
import { FileWorkStep, WorkStep } from './workStep'
import { classToPlain } from 'class-transformer'

export interface WorkResult {
	status: WorkStepStatus
	messages?: string[]
}

export class Worker {
	private _busy: boolean = false
	private _db: PouchDB.Database
	logger: Winston.LoggerInstance

	constructor (logger: Winston.LoggerInstance, db: PouchDB.Database) {
		this._db = db
		this.logger = logger
	}

	get busy (): boolean {
		return this._busy
	}

	async doWork (step: WorkStep): Promise<WorkResult> {
		const progressReportFailed = (e) => {
			this.logger.warn(`Worker could not report progress: ${e}`)
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
			case WorkStepAction.DELETE:
				return this.doDelete(step as any as FileWorkStep)
					.then((result: WorkResult) => {
						this._busy = false
						return result
					})
			default:
				return Promise.resolve().then(() => {
					return literal<WorkResult>({
						status: WorkStepStatus.ERROR,
						messages: [
							`Worker could not recognize action: ${step.action}`
						]
					})
				})
		}
	}

	private async reportProgress (step: WorkStep, progress: number): Promise<void> {
		step.progress = progress
		this.logger.debug(`${step._id}: Progress ${Math.round(progress * 100)}%`)
		return this._db.put(classToPlain(step)).then(() => { return })
	}

	private async doCopy (step: FileWorkStep, reportProgress?: (progress: number) => void): Promise<WorkResult> {
		return step.target.handler.putFile(step.file, reportProgress).then(() => {
			return literal<WorkResult>({
				status: WorkStepStatus.DONE
			})
		}, (e) => {
			return literal<WorkResult>({
				status: WorkStepStatus.ERROR,
				messages: [
					e
				]
			})
		})
	}

	private async doDelete (step: FileWorkStep): Promise<WorkResult> {
		return step.target.handler.deleteFile(step.file).then(() => {
			return literal<WorkResult>({
				status: WorkStepStatus.DONE
			})
		}, (e) => {
			return literal<WorkResult>({
				status: WorkStepStatus.ERROR,
				messages: [
					e
				]
			})
		})
	}
}
