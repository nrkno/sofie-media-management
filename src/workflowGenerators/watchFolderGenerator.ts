import * as _ from 'underscore'
import { getCurrentTime, literal, randomId, getWorkFlowName } from '../lib/lib'
import { WorkFlow, WorkFlowSource, WorkStep, WorkStepAction, MediaFlow, MediaFlowType, WorkStepStatus } from '../api'
import { LocalStorageGenerator, WorkFlowGeneratorEventType } from './localStorageGenerator'
import { File, StorageObject, StorageEvent, StorageEventType } from '../storageHandlers/storageHandler'
import { TrackedMediaItems, TrackedMediaItem } from '../mediaItemTracker'
import { FileWorkStep } from '../work/workStep'
import { LoggerInstance } from 'winston'

export class WatchFolderGenerator extends LocalStorageGenerator {
	private _storageMapping: _.Dictionary<string> = {}
	private _sourceStoragesWithCronJob: StorageObject[] = []
	private _destinationStorages: StorageObject[] = []
	private _cronJob: NodeJS.Timer

	/** The interval of which to check whether some files were deleted. */
	private CRON_JOB_INTERVAL = 10 * 60 * 1000 // 10 minutes (ms)

	protected ident: string = 'Watch folder generator:'

	constructor(
		availableStorage: StorageObject[],
		tracked: TrackedMediaItems,
		flows: MediaFlow[],
		protected logger: LoggerInstance,
		cronJobTime?: number
	) {
		super(availableStorage, tracked, flows, logger)
		this.CRON_JOB_INTERVAL = cronJobTime || this.CRON_JOB_INTERVAL
	}

	async init(): Promise<void> {
		return Promise.resolve().then(() => {
			this._flows.forEach(item => {
				if (item.mediaFlowType === MediaFlowType.WATCH_FOLDER) {
					const srcStorage = this._availableStorage.find(i => i.id === item.sourceId)
					const dstStorage = this._availableStorage.find(i => i.id === item.destinationId)

					if (srcStorage && dstStorage) {
						if (srcStorage.options.onlySelectedFiles) {
							this.logger.error(
								`${this.ident} ${this.constructor.name} cannot run on a storage with onlySelectedFiles: "${srcStorage.id}"!`
							)
							return
						}
						this.registerStoragePair(srcStorage, dstStorage, item.copyRemoved)
					}
				}
			})

			this._cronJob = setInterval(() => {
				this.cronJob()
			}, this.CRON_JOB_INTERVAL)
		})
	}

	protected registerStoragePair(srcStorage: StorageObject, dstStorage: StorageObject, withCronJob?: boolean) {
		this._storageMapping[srcStorage.id] = dstStorage.id
		if (withCronJob) {
			this._sourceStoragesWithCronJob.push(srcStorage)
		}
		this._destinationStorages.push(dstStorage)
		super.registerStorage(srcStorage)
	}

	protected generateNewFileWorkSteps(file: File, st: StorageObject): WorkStep[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.COPY,
				file: file,
				target: st,
				priority: 2,
				criticalStep: true,
				status: WorkStepStatus.IDLE
			}) as WorkStep
		].concat(super.generateNewFileWorkSteps(file, st))
	}

	protected generateDeleteFileWorkSteps(file: File, st: StorageObject): WorkStep[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.DELETE,
				file: file,
				target: st,
				priority: 2,
				criticalStep: true,
				status: WorkStepStatus.IDLE
			})
		]
	}

	private onFileUpdated(st: StorageObject, e: StorageEvent) {
		if (!e.file) throw new Error(`${this.ident} onFileUpdated: Invalid event type or arguments.`)
		const localFile = e.file
		const dstStorageId = this._storageMapping[st.id]
		const targetStorage = this._availableStorage.find(i => i.id === dstStorageId)
		if (!targetStorage)
			throw new Error(`${this.ident} onFileUpdated: Could not find target storage "${dstStorageId}"`)
		this._tracked
			.getById(e.path)
			.then(
				() => {
					this.logger.debug(
						`${this.ident} onFileUpdated: File "${e.path}" is already tracked, "${st.id}" ignoring.`
					)

					return Promise.resolve()
				},
				() => {
					return this.registerFile(localFile, st, [targetStorage])
						.then(() => {
							this.logger.debug(
								`${this.ident} onFileUpdated: ` +
									`File "${e.path}" has started to be tracked by ${this.constructor.name} for "${st.id}".`
							)
						})
						.catch(e => {
							this.logger.error(`${this.ident} onFileUpdated: Tracked file registration failed`, e)
						})
				}
			)
			.then(() => {
				const emitCopy = () => {
					const workflowId = e.path + '_' + randomId()
					this.emit(
						WorkFlowGeneratorEventType.NEW_WORKFLOW,
						literal<WorkFlow>({
							_id: workflowId,
							name: getWorkFlowName(localFile.name),
							finished: false,
							priority: 1,
							source: WorkFlowSource.LOCAL_MEDIA_ITEM,
							steps: this.generateNewFileWorkSteps(localFile, targetStorage),
							created: getCurrentTime(),
							success: false
						}),
						this
					)
					this.logger.debug(
						`${this.ident} onFileUpdated: New forkflow started for "${e.path}": "${workflowId}".`
					)
				}

				return targetStorage.handler.getFile(localFile.name).then(
					file => {
						return file.getProperties().then(properties => {
							return localFile.getProperties().then(localProperties => {
								if (localProperties.size !== properties.size) {
									emitCopy()
								}
							})
						})
					},
					() => {
						emitCopy()
					}
				)
			})
			.then(() => {})
			.catch(e =>
				this.logger.error(`${this.ident} onFileUpdated: An error was thrown when handling an updated file`, e)
			)
	}

	protected onAdd(st: StorageObject, e: StorageEvent, _initialScan?: boolean) {
		return this.onFileUpdated(st, e)
	}

	protected onChange(st: StorageObject, e: StorageEvent) {
		return this.onAdd(st, e)
	}

	protected onDelete(st: StorageObject, e: StorageEvent, _initialScan?: boolean) {
		this._tracked.getById(e.path).then(
			tmi => {
				if (tmi.sourceStorageId === st.id) {
					tmi.targetStorageIds.forEach(sId => {
						const storageObject = this._availableStorage.find(as => as.id === sId)
						if (storageObject) {
							storageObject.handler
								.getFile(tmi.name)
								.then(file => {
									const workflowId = e.path + '_' + randomId()
									this.emit(
										WorkFlowGeneratorEventType.NEW_WORKFLOW,
										literal<WorkFlow>({
											_id: workflowId,
											name: getWorkFlowName(file.name),
											finished: false,
											priority: 1,
											source: WorkFlowSource.SOURCE_STORAGE_REMOVE,
											steps: this.generateDeleteFileWorkSteps(file, storageObject),
											created: getCurrentTime(),
											success: false
										}),
										this
									)
									// return storageObject.handler.deleteFile(file)
								})
								.then(() => {
									this.logger.debug(
										`${this.ident} onDelete: ` +
											`New workflow to delete file "${tmi.name}" from target storage "${storageObject.id}"`
									)
								})
								.catch(e => {
									this.logger.warn(
										`${this.ident} onDelete: Could not find file in target storage: "${storageObject.id}"`,
										e
									)
								})
						}
					})
					this._tracked.remove(tmi).then(
						() => {
							this.logger.debug(
								`${this.ident} onDelete: ` +
									`Tracked file "${e.path}" deleted from storage "${st.id}" became untracked.`
							)
						},
						e => {
							this.logger.error(
								`${this.ident} onDelete: ` +
									`Tracked file "${e.path}" deleted from storage "${st.id}" could not become untracked`,
								e
							)
						}
					)
				}
				// TODO: generate a pull from sourceStorage?
			},
			e => {
				this.logger.debug(`${this.ident} onDelete: Untracked file "${e.path}" deleted from storage "${st.id}".`)
			}
		)
	}

	protected async initialCheck(st: StorageObject): Promise<void> {
		const initialScanTime = getCurrentTime()
		const dstStorageId = this._storageMapping[st.id]
		const targetStorage = this._availableStorage.find(i => i.id === dstStorageId)
		if (!targetStorage) throw new Error(`${this.ident} initialCheck: Target storage "${dstStorageId}" not found!`)

		return st.handler
			.getAllFiles()
			.then(allFiles => {
				return Promise.all(
					allFiles.map(
						async (file): Promise<void> => {
							try {
								const trackedFile = await this._tracked.getById(file.name)
								if (trackedFile.sourceStorageId === st.id) {
									trackedFile.lastSeen = initialScanTime
									try {
										await this._tracked.put(trackedFile)
									} catch (e1) {
										this.logger.error(
											`${this.ident} initialCheck: Could not update "${trackedFile.name}" last seen: ${e1}`
										)
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
							this.logger.debug(`${this.ident} initialCheck: Finished handling file: ${file.name}`)
						}
					)
				)
			})
			.then(async () => {
				const staleFiles = await this._tracked.getAllFromStorage(st.id, {
					lastSeen: {
						$lt: initialScanTime
					}
				})
				staleFiles.map(sFile => {
					this.onDelete(st, {
						type: StorageEventType.delete,
						path: sFile.name
					})
				})
			})
	}

	protected cronJob() {
		this.logger.debug(`${this.ident} cronJob: Starting cron job for ${this.constructor.name}`)
		this.logger.debug(`${this.ident} cronJob: Doing storage check`)
		this._sourceStoragesWithCronJob.forEach(i => this.storageCheck(i))
	}

	protected async storageCheck(st: StorageObject): Promise<void> {
		const tmis = await this._tracked.getAllFromStorage(st.id)
		tmis.forEach(item => this.checkAndEmitCopyWorkflow(item, 'storageCheck'))
	}

	/**
	 * Checks if the item exists on the storage and issues workflows
	 * @param tmi
	 */
	protected checkAndEmitCopyWorkflow(tmi: TrackedMediaItem, reason: string) {
		if (!tmi.sourceStorageId)
			throw new Error(
				`${this.ident} checkAndEmitCopyWorkflow: Tracked Media Item "${tmi._id}" has no source storage!`
			)
		const storage = this._sourceStoragesWithCronJob.find(i => i.id === tmi.sourceStorageId)
		if (!storage)
			throw new Error(`${this.ident} checkAndEmitCopyWorkflow: Could not find storage "${tmi.sourceStorageId}"`)

		// get file from source storage
		this.getFile(tmi.name, tmi.sourceStorageId)
			.then(file => {
				if (file && storage) {
					file.getProperties()
						.then(sFileProps => {
							this._destinationStorages
								.filter(i => tmi.targetStorageIds.indexOf(i.id) >= 0)
								.forEach(i => {
									// check if the file exists on the target storage
									i.handler.getFile(tmi.name).then(
										rFile => {
											// the file exists on target storage
											rFile.getProperties().then(
												rFileProps => {
													if (rFileProps.size !== sFileProps.size) {
														// File size doesn't match
														this.emitCopyWorkflow(
															file,
															i,
															tmi.comment,
															reason,
															`File size doesn't match on target storage`
														)
													}
												},
												e => {
													// Properties could not be fetched
													this.logger.error(
														`${this.ident} checkAndEmitCopyWorkflow: ` +
															`File "${tmi.name}" exists on storage "${i.id}", but it's properties could not be checked. Attempting to write over.`,
														e
													)
													this.emitCopyWorkflow(
														file,
														i,
														tmi.comment,
														reason,
														`Could not fetch target file properties`
													)
												}
											)
										},
										_err => {
											// the file not found
											this.emitCopyWorkflow(
												file,
												i,
												tmi.comment,
												reason,
												`File not found on target storage`
											)
										}
									)
								})
						})
						.catch(e => {
							this.logger.error(
								`${this.ident} checkAndEmitCopyWorkflow: Could not fetch file "${tmi.name}" properties from storage`,
								e
							)
						})
				}
			})
			.catch(e => {
				this.logger.error(
					`${this.ident} checkAndEmitCopyWorkflow: ` +
						`File "${tmi.name}" failed to be checked in source storage "${tmi.sourceStorageId}"`,
					e
				)
			})
	}

	private getFile(fileName: string, sourceStorageId: string): Promise<File | undefined> {
		const sourceStorage = this._sourceStoragesWithCronJob.find(i => i.id === sourceStorageId)
		if (!sourceStorage) throw new Error(`Source storage "${sourceStorageId}" could not be found.`)

		return new Promise<File | undefined>((resolve, _reject) => {
			sourceStorage.handler.getFile(fileName).then(
				file => {
					resolve(file)
				},
				_reason => {
					resolve(undefined)
				}
			)
		})
	}

	protected emitCopyWorkflow(
		file: File,
		targetStorage: StorageObject,
		comment: string | undefined,
		...reason: string[]
	) {
		const workflowId = file.name + '_' + randomId()
		this.emit(
			WorkFlowGeneratorEventType.NEW_WORKFLOW,
			literal<WorkFlow>({
				_id: workflowId,
				name: getWorkFlowName(file.name),
				comment: comment,
				finished: false,
				priority: 1,
				source: WorkFlowSource.TARGET_STORAGE_REMOVE,
				steps: this.generateNewFileWorkSteps(file, targetStorage),
				created: getCurrentTime(),
				success: false
			}),
			this
		)
		this.logger.debug(
			`${this.ident} emitCopyWorkflow: New forkflow started for "${file.name}": "${workflowId}". ${reason.join(
				', '
			)}`
		)
	}

	async destroy() {
		return Promise.resolve().then(() => {
			clearInterval(this._cronJob)
		})
	}
}
