import * as _ from 'underscore'
import { getCurrentTime, literal, randomId } from '../lib/lib'
import { WorkFlow, WorkFlowSource, WorkStep, WorkStepAction, MediaFlow, MediaFlowType } from '../api'
import { LocalStorageGenerator, WorkFlowGeneratorEventType } from './localStorageGenerator'
import { File, StorageObject, StorageEvent, StorageEventType } from '../storageHandlers/storageHandler'
import { TrackedMediaItems } from '../mediaItemTracker'
import { FileWorkStep } from '../work/workStep'

export class WatchFolderGenerator extends LocalStorageGenerator {
	private _storageMapping: _.Dictionary<string> = {}

	constructor (availableStorage: StorageObject[], tracked: TrackedMediaItems, flows: MediaFlow[]) {
		super(availableStorage, tracked, flows)
	}

	async init (): Promise<void> {
		return Promise.resolve().then(() => {
			this._flows.forEach((item) => {
				if (item.mediaFlowType === MediaFlowType.WATCH_FOLDER) {
					const srcStorage = this._availableStorage.find(i => i.id === item.sourceId)
					const dstStorage = this._availableStorage.find(i => i.id === item.destinationId)

					if (srcStorage && dstStorage) {
						this.registerStoragePair(srcStorage, dstStorage)
					}
				}
			})
		})
	}

	protected registerStoragePair (srcStorage: StorageObject, dstStorage: StorageObject) {
		this._storageMapping[srcStorage.id] = dstStorage.id
		super.registerStorage(srcStorage)
	}

	protected generateNewFileWorkSteps (file: File, st: StorageObject): WorkStep[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.COPY,
				file: file,
				target: st,
				priority: 2
			}) as WorkStep
		].concat(super.generateNewFileWorkSteps(file, st))
	}

	protected generateDeleteFileWorkSteps (file: File, st: StorageObject): WorkStep[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.DELETE,
				file: file,
				target: st,
				priority: 2
			})
		]
	}

	private onFileUpdated (st: StorageObject, e: StorageEvent) {
		if (!e.file) throw new Error(`Invalid event type or arguments.`)
		const localFile = e.file
		const dstStorageId = this._storageMapping[st.id]
		const targetStorage = this._availableStorage.find((i) => i.id === dstStorageId)
		if (!targetStorage) throw new Error(`Could not find target storage "${dstStorageId}"`)
		this._tracked.getById(e.path).then(() => {
			this.emit('debug', `File "${e.path}" is already tracked, "${st.id}" ignoring.`)

			return Promise.resolve()
		}, () => {
			return this.registerFile(localFile, st, [ targetStorage ]).then(() => {
				this.emit('debug', `File "${e.path}" has started to be tracked by ${this.constructor.name} for "${st.id}".`)
			}).catch((e) => {
				this.emit('error', `Tracked file registration failed: ${e}`)
			})
		}).then(() => {
			const emitCopy = () => {
				const workflowId = e.path + '_' + randomId()
				this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
					_id: workflowId,
					name: localFile.name,
					finished: false,
					priority: 1,
					source: WorkFlowSource.LOCAL_MEDIA_ITEM,
					steps: this.generateNewFileWorkSteps(localFile, targetStorage),
					created: getCurrentTime(),
					success: false
				}), this)
				this.emit('debug', `New forkflow started for "${e.path}": "${workflowId}".`)
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
		}).then(() => { })
		.catch((e) => this.emit('error', `An error was thrown when handling an updated file: ${e}`))
	}

	protected onAdd (st: StorageObject, e: StorageEvent, _initialScan?: boolean) {
		return this.onFileUpdated(st, e)
	}

	protected onChange (st: StorageObject, e: StorageEvent) {
		return this.onAdd(st, e)
	}

	protected onDelete (st: StorageObject, e: StorageEvent, _initialScan?: boolean) {
		this._tracked.getById(e.path).then((tmi) => {
			if (tmi.sourceStorageId === st.id) {
				tmi.targetStorageIds.forEach((sId) => {
					const storageObject = this._availableStorage.find((as) => as.id === sId)
					if (storageObject) {
						storageObject.handler.getFile(tmi.name).then((file) => {
							const workflowId = e.path + '_' + randomId()
							this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
								_id: workflowId,
								name: file.name,
								finished: false,
								priority: 1,
								source: WorkFlowSource.SOURCE_STORAGE_REMOVE,
								steps: this.generateDeleteFileWorkSteps(file, storageObject),
								created: getCurrentTime(),
								success: false
							}), this)
							// return storageObject.handler.deleteFile(file)
						}).then(() => {
							this.emit('debug', `New workflow to delete file "${tmi.name}" from target storage "${storageObject.id}"`)
						}).catch((e) => {
							this.emit('warn', `Could not find file in target storage: "${storageObject.id}": ${e}`)
						})
					}
				})
				this._tracked.remove(tmi).then(() => {
					this.emit('debug', `Tracked file "${e.path}" deleted from storage "${st.id}" became untracked.`)
				}, (e) => {
					this.emit('error', `Tracked file "${e.path}" deleted from storage "${st.id}" could not become untracked: ${e}`)
				})
			}
			// TODO: generate a pull from sourceStorage?
		}, (e) => {
			this.emit('debug', `Untracked file "${e.path}" deleted from storage "${st.id}".`)
		})
	}

	protected async initialCheck (st: StorageObject): Promise<void> {
		const initialScanTime = getCurrentTime()
		const dstStorageId = this._storageMapping[st.id]
		const targetStorage = this._availableStorage.find((i) => i.id === dstStorageId)
		if (!targetStorage) throw new Error(`Target storage "${dstStorageId}" not found!`)

		return st.handler.getAllFiles().then((allFiles) => {
			return Promise.all(allFiles.map(async (file): Promise<void> => {
				try {
					const trackedFile = await this._tracked.getById(file.name)
					if (trackedFile.sourceStorageId === st.id) {
						trackedFile.lastSeen = initialScanTime
						try {
							await this._tracked.put(trackedFile)
						} catch (e1) {
							this.emit('error', `Could not update "${trackedFile.name}" last seen: ${e1}`)
						}

						await targetStorage.handler.getFile(trackedFile.name)
					}
				} catch (e) {
					this.onAdd(st, {
						type: StorageEventType.add,
						path: file.name,
						file: file
					})
				}
				this.emit('debug', `Finished handling file: ${file.name}`)
			}))
		}).then(async () => {
			const staleFiles = await this._tracked.getAllFromStorage(st.id, {
				lastSeen: {
					$lt: initialScanTime
				}
			})
			staleFiles.map((sFile) => {
				this.onDelete(st, {
					type: StorageEventType.delete,
					path: sFile.name
				})
			})
		})
	}
}
