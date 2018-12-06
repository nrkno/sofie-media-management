import * as Winston from 'winston'

import { getCurrentTime, literal, randomId } from '../lib/lib'
import { WorkFlow, WorkFlowSource, WorkStepBase, WorkStepAction } from '../api'
import { LocalStorageGenerator, WorkFlowGeneratorEventType } from './localStorageGenerator'
import { File, StorageObject, StorageEvent, StorageEventType } from '../storageHandlers/storageHandler'
import { TrackedMediaItems } from '../mediaItemTracker'
import { FileWorkStep } from '../work/workStep'

export class WatchFolderGenerator extends LocalStorageGenerator {
	constructor (logger: Winston.LoggerInstance, availableStorage: StorageObject[], tracked: TrackedMediaItems) {
		super(logger, availableStorage, tracked)
	}

	async init (): Promise<void> {
		return Promise.resolve().then(() => {
			this._availableStorage.forEach((item) => {
				if (item.watchFolder && item.watchFolderTargetId) this.registerStorage(item)
			})
		})
	}

	protected generateNewFileWorkSteps (file: File, st: StorageObject): WorkStepBase[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.COPY,
				file: file,
				target: st,
				priority: 1
			})
		]
	}

	protected onAdd (st: StorageObject, e: StorageEvent, initialScan?: boolean) {
		if (e.type !== StorageEventType.add || !e.file) throw new Error(`Invalid event type or arguments.`)
		const localFile = e.file
		const targetStorage = this._availableStorage.find((i) => i.id === st.watchFolderTargetId)
		if (!targetStorage) throw new Error(`Could not find target storage "${st.watchFolderTargetId}"`)
		this._tracked.getById(e.path).then(() => {
			this.logger.debug(`File "${e.path}" is already tracked, "${st.id}" ignoring.`)

			return Promise.resolve()
		}, () => {
			return this.registerFile(localFile, st).then(() => {
				this.logger.debug(`File "${e.path}" has started to be tracked by localStorageGenerator for "${st.id}".`)
			}).catch((e) => {
				this.logger.error(`Tracked file registration failed: ${e}`)
			})
		}).then(() => {
			const emitCopy = () => {
				const workflowId = e.path + '_' + randomId()
				this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
					_id: workflowId,
					finished: false,
					priority: 1,
					source: WorkFlowSource.LOCAL_MEDIA_ITEM,
					steps: this.generateNewFileWorkSteps(localFile, targetStorage)
				}))
				this.logger.debug(`New forkflow started for "${e.path}": "${workflowId}".`)
			}

			return targetStorage.handler.getFile(localFile.name).then((file) => {
				return file.getProperties().then((properties) => {
					return localFile.getProperties().then((localProperties) => {
						if (localProperties.size !== properties.size) {
							emitCopy()
						}
					})
				})
			}, () => {
				emitCopy()
			})
		})
	}
}
