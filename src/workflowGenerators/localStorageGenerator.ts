import * as Winston from 'winston'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from './baseWorkFlowGenerator'
import { File, StorageEvent, StorageObject, StorageEventType } from '../storageHandlers/storageHandler'
import { TrackedMediaItems, TrackedMediaItemBase } from '../mediaItemTracker'
export * from './baseWorkFlowGenerator'
import { getCurrentTime, literal, randomId } from '../lib/lib'
import { WorkFlow, WorkFlowSource, WorkStepAction, WorkStepBase } from '../api'
import { FileWorkStep } from '../work/workStep'
import { LocalFolderFile } from '../storageHandlers/localFolderHandler';

export class LocalStorageGenerator extends BaseWorkFlowGenerator {
	protected _availableStorage: StorageObject[]
	protected _tracked: TrackedMediaItems
	logger: Winston.LoggerInstance

	private LOCAL_LINGER_TIME = 7 * 24 * 60 * 60 * 1000

	constructor (logger: Winston.LoggerInstance, availableStorage: StorageObject[], tracked: TrackedMediaItems) {
		super()
		this._availableStorage = availableStorage
		this._tracked = tracked
		this.logger = logger
	}

	async init (): Promise<void> {
		this.logger.debug(`Initializing WorkFlow generator ${this.constructor.name}`)
		return Promise.resolve().then(() => {
			this._availableStorage.forEach((item) => {
				if (item.manualIngest) this.registerStorage(item)
			})
		})
	}

	async destroy (): Promise<void> {
		return Promise.resolve()
	}

	protected registerStorage (st: StorageObject) {
		this.logger.debug(`Registering storage: "${st.id}" in ${this.constructor.name}`)
		st.handler.on(StorageEventType.add, (e: StorageEvent) => this.onAdd(st, e))
		st.handler.on(StorageEventType.change, (e: StorageEvent) => this.onChange(st, e))
		st.handler.on(StorageEventType.delete, (e: StorageEvent) => this.onDelete(st, e))

		this.initialCheck(st).then(() => {
			this.logger.info(`Initial ${this.constructor.name} scan for "${st.id}" complete.`)
		}, (e) => {
			this.logger.info(`Initial ${this.constructor.name} scan for "${st.id}" failed: ${e}.`)
		})
	}

	protected generateChangedFileWorkSteps (file: File, st: StorageObject): WorkStepBase[] {
		return this.generateNewFileWorkSteps(file, st)
	}

	protected generateNewFileWorkSteps (file: File, st: StorageObject): WorkStepBase[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.GENERATE_METADATA,
				file: file,
				target: st,
				priority: 1
			}),
			new FileWorkStep({
				action: WorkStepAction.GENERATE_THUMBNAIL,
				file: file,
				target: st,
				priority: 0.5
			})
		]
	}

	protected registerFile (file: File, st: StorageObject): Promise<void> {
		return this._tracked.put(literal<TrackedMediaItemBase>({
			_id: file.name,
			sourceStorageId: st.id,
			lastSeen: getCurrentTime(),
			lingerTime: this.LOCAL_LINGER_TIME,
			targetStorageIds: [],
			name: file.name
		})).then(() => { return })
	}

	protected onAdd (st: StorageObject, e: StorageEvent, initialScan?: boolean) {
		if (e.type !== StorageEventType.add || !e.file) throw new Error(`Invalid event type or arguments.`)
		const localFile = e.file
		this._tracked.getById(e.path).then(() => {
			this.logger.debug(`File "${e.path}" is already tracked, "${st.id}" ignoring.`)
		}, () => {
			this.registerFile(localFile, st).then(() => {
				this.logger.debug(`File "${e.path}" has started to be tracked by ${this.constructor.name} for "${st.id}".`)
				const workflowId = e.path + '_' + randomId()
				this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
					_id: workflowId,
					finished: false,
					priority: 1,
					source: WorkFlowSource.LOCAL_MEDIA_ITEM,
					steps: this.generateNewFileWorkSteps(localFile, st)
				}))
				this.logger.debug(`New forkflow started for "${e.path}": "${workflowId}".`)
			}).catch((e) => {
				this.logger.error(`Tracked file registration failed: ${e}`)
			})
		})
	}

	protected onChange (st: StorageObject, e: StorageEvent) {
		if (e.type !== StorageEventType.change || !e.file) throw new Error(`Invalid event type or arguments.`)
		const localFile = e.file
		this._tracked.getById(e.path).then((tmi) => {
			if (tmi.sourceStorageId === st.id) {
				const workflowId = e.path + '_' + randomId()
				this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
					_id: workflowId,
					finished: false,
					priority: 1,
					source: WorkFlowSource.LOCAL_MEDIA_ITEM,
					steps: this.generateNewFileWorkSteps(localFile, st)
				}))
				this.logger.debug(`New forkflow started for "${e.path}": "${workflowId}".`)
			}
		}).catch((e) => {
			this.logger.error(`Unregistered file "${e.path}" changed!`)
		})
	}

	private onDelete (st: StorageObject, e: StorageEvent, initialScan?: boolean) {
		this._tracked.getById(e.path).then((tmi) => {
			if (tmi.sourceStorageId === st.id) {
				this._tracked.remove(tmi).then(() => {
					this.logger.debug(`Tracked file "${e.path}" deleted from storage "${st.id}" became untracked.`)
				}, (e) => {
					this.logger.error(`Tracked file "${e.path}" deleted from storage "${st.id}" could not become untracked: ${e}`)
				})
			}
			// TODO: generate a pull from sourceStorage?
		}, (e) => {
			this.logger.debug(`Untracked file "${e.path}" deleted from storage "${st.id}".`)
		})
	}

	private async initialCheck (st: StorageObject): Promise<void> {
		const initialScanTime = getCurrentTime()

		return st.handler.getAllFiles().then((allFiles) => {
			return Promise.all(allFiles.map(async (file) => {
				try {
					const trackedFile = await this._tracked.getById(file.name)
					if (trackedFile.sourceStorageId === st.id) {
						trackedFile.lastSeen = initialScanTime
						try {
							await this._tracked.put(trackedFile)
						} catch (e1) {
							this.logger.error(`Could not update "${trackedFile.name}" last seen: ${e1}`)
						}
					}
				} catch (e) {
					this.onAdd(st,{
						type: StorageEventType.add,
						path: file.name,
						file: file
					})
				}
			}))
		}).then(async () => {
			const staleFiles = await this._tracked.getAllFromStorage(st.id, {
				lastSeen: {
					$lt: initialScanTime
				}
			})
			await Promise.all(staleFiles.map((sFile) => this._tracked.remove(sFile)))
		})
	}
}
