import * as _ from 'underscore'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import {
	ExpectedMediaItem,
	MediaFlow,
	MediaFlowType,
	WorkFlowSource,
	WorkStepAction,
	WorkStep,
	WorkFlow,
	WorkStepStatus
} from '../api'
import { TrackedMediaItems, TrackedMediaItemDB, TrackedMediaItem } from '../mediaItemTracker'
import { StorageObject, StorageEventType, File, StorageEvent } from '../storageHandlers/storageHandler'
import { Collection, Observer } from 'tv-automation-server-core-integration'
import { randomId, literal, getCurrentTime, getWorkFlowName, retryNumber } from '../lib/lib'
import { FileWorkStep, ScannerWorkStep } from '../work/workStep'

/**
 * Monitors the expected items from Core and generates workflows needed to make it so
 */
export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler

	/** Contain all of our tracked items
	 * (tracked items are anything that we have ever heard of or have ever touched),
	 * like expected items, watchfolder items etc...
	 */
	private _trackedItems: TrackedMediaItems

	/** ALL the storages from dispatcher, not just ours */
	private _allStorages: StorageObject[]
	/** Our storages, registered to us, with our event handlers */
	private _storages: StorageObject[] = []

	/** ALL flows from dispatcher, not just ours */
	private _allFlows: MediaFlow[] = []
	/** Our flows */
	private _handledFlows: { [flowId: string]: MediaFlow } = {}

	private expectedMediaItems: () => Collection
	private observer: Observer

	private _cronJob: NodeJS.Timer

	private _expectedMediaItemsSubscription: string

	/** The interval of which to check whether files are still expected. */
	private CRON_JOB_INTERVAL = 10 * 60 * 1000 // 10 minutes (ms)

	/** The default linger time */
	private LINGER_TIME = 3 * 24 * 60 * 60 * 1000 // 3 days (ms)

	/** Time to retry failed operations */
	private RETRY_COUNT = 5
	/** Delay between retries */
	private RETRY_TIMEOUT = 2000

	private _cachedStudioId: string | undefined = undefined

	constructor(
		availableStorage: StorageObject[],
		tracked: TrackedMediaItems,
		flows: MediaFlow[],
		coreHandler: CoreHandler,
		lingerTime?: number,
		cronJobTime?: number
	) {
		super()
		this._allStorages = availableStorage
		this._coreHandler = coreHandler
		this._trackedItems = tracked
		this._allFlows = flows

		this.LINGER_TIME = lingerTime || this.LINGER_TIME
		this.CRON_JOB_INTERVAL = cronJobTime || this.CRON_JOB_INTERVAL
	}

	async init(): Promise<void> {
		this._allFlows.forEach(item => {
			if (item.mediaFlowType === MediaFlowType.EXPECTED_ITEMS) {
				const storage = this._allStorages.find(i => i.id === item.sourceId)
				if (!storage) {
					this.emit('debug', `Storage "${item.sourceId}" could not be found among available storage.`)
					return
				}

				// register handled flows
				this._handledFlows[item.id] = item
				// register used storage
				this.registerSourceStorage(storage)
			}
		})

		this._coreHandler.core.onConnected(() => {
			this.setupSubscribtionsAndObservers().catch(e => {
				this.emit('error', `Error while resetting the subscribtions`, e)
			})
		})

		this._cronJob = setInterval(() => {
			this.cronJob()
		}, this.CRON_JOB_INTERVAL)

		return this.setupSubscribtionsAndObservers()
	}
	/**
	 * Subscribe to the data from Core
	 */
	async setupSubscribtionsAndObservers(): Promise<void> {
		if (this._expectedMediaItemsSubscription) {
			this._coreHandler.core.unsubscribe(this._expectedMediaItemsSubscription)
		}
		this._expectedMediaItemsSubscription = await this._coreHandler.core.subscribe('expectedMediaItems', {
			mediaFlowId: {
				$in: _.keys(this._handledFlows)
			},
			studioId: this._getStudioId()
		})
		this.emit('debug', 'Subscribed to expectedMediaItems.')

		this.expectedMediaItems = () => this._coreHandler.core.getCollection('expectedMediaItems')

		const observer = this._coreHandler.core.observe('expectedMediaItems')
		observer.added = this.wrapError(this.onExpectedAdded)
		observer.changed = this.wrapError(this.onExpectedChanged)
		observer.removed = this.wrapError(this.onExpectedRemoved)

		this.observer = observer

		this.emit('debug', 'Observer set up')

		return this.initialExpectedCheck()
	}

	private wrapError = (fcn: Function) => {
		return (...args) => {
			try {
				return fcn(...args)
			} catch (e) {
				this.emit('error', e)
			}
		}
	}

	async destroy(): Promise<void> {
		return Promise.resolve().then(() => {
			this._coreHandler.core.unsubscribe(this._expectedMediaItemsSubscription)
			clearInterval(this._cronJob)
			this.observer.stop()
		})
	}

	private _getPeripheralDevice() {
		let peripheralDevices = this._coreHandler.core.getCollection('peripheralDevices')
		return peripheralDevices.findOne(this._coreHandler.core.deviceId)
	}
	private _getStudio(): any | null {
		let peripheralDevice = this._getPeripheralDevice()
		if (peripheralDevice) {
			let studios = this._coreHandler.core.getCollection('studios')
			return studios.findOne(peripheralDevice.studioId)
		}
		return null
	}
	private _getStudioId(): string | null {
		if (this._cachedStudioId) return this._cachedStudioId

		let studio = this._getStudio()
		if (studio) {
			this._cachedStudioId = studio._id
			return studio._id
		}
		return null
	}
	private shouldHandleItem(item: ExpectedMediaItem): boolean {
		return (
			this._handledFlows[item.mediaFlowId] && item.studioId === this._getStudioId() // if the item is in the list of handled flows // if the item is in the right studio
		)
	}

	/** Called when an item is added (from Core) */
	private onExpectedAdded = (id: string, obj?: ExpectedMediaItem) => {
		let item: ExpectedMediaItem
		if (obj) {
			item = obj
		} else {
			item = this.expectedMediaItems().findOne(id) as ExpectedMediaItem
		}
		if (item.lastSeen + (item.lingerTime || this.LINGER_TIME) < getCurrentTime()) {
			this.emit(
				'error',
				`An expected item was added called "${item.label || item.path}", but it expired on ${new Date(
					item.lastSeen + (item.lingerTime || this.LINGER_TIME)
				)}. Ignoring.`
			)
			return
		}
		if (item.disabled) {
			this.emit('warn', `An expected item was added called "${item.label || item.path}", but it was disabled.`)
			return
		}
		if (!item) throw new Error(`Could not find the new item "${id}" in expectedMediaItems`)

		if (!this.shouldHandleItem(item)) return

		const flow = this._handledFlows[item.mediaFlowId]

		if (!flow) {
			throw new Error(`Could not find mediaFlow "${item.mediaFlowId}" for expected media item "${item._id}"`)
		}
		if (!flow.destinationId) throw new Error(`Destination not set in flow "${flow.id}".`)

		const sourceStorage = this._storages.find(i => i.id === flow.sourceId)
		if (!sourceStorage) throw new Error(`Could not find source storage "${flow.sourceId}"`)

		let fileName: string
		try {
			fileName = sourceStorage.handler.parseUrl(item.url)
		} catch (e) {
			this.emit('error', `Assigned source storage "${sourceStorage.id}" does not support file "${item.url}"`)
			return
		}

		const baseObj: TrackedMediaItem = {
			_id: fileName,
			name: fileName,
			comment: item.label,
			expectedMediaItemId: [item._id],
			lastSeen: item.lastSeen,
			lingerTime: item.lingerTime || this.LINGER_TIME,
			sourceStorageId: flow.sourceId,
			targetStorageIds: [flow.destinationId]
		}
		this._trackedItems
			.upsert(baseObj._id, (tmi?: TrackedMediaItem) => {
				if (tmi) {
					baseObj.lastSeen = Math.max(baseObj.lastSeen, tmi.lastSeen)
					baseObj.lingerTime = Math.max(baseObj.lingerTime, tmi.lingerTime)
					baseObj.expectedMediaItemId = _.union(
						baseObj.expectedMediaItemId || [],
						tmi.expectedMediaItemId || []
					)
					baseObj.targetStorageIds = _.union(baseObj.targetStorageIds || [], tmi.targetStorageIds || [])
				}
				return baseObj
			})
			.then(() => this.checkAndEmitCopyWorkflow(baseObj, 'onExpectedAdded'))
			.catch(e => {
				this.emit('error', `An error happened when trying to create a copy workflow`, e)
			})
	}

	/** Called when an item is changed in Core */
	private onExpectedChanged = (id: string, _oldFields: any, clearedFields: any, newFields: any) => {
		let item: ExpectedMediaItem = this.expectedMediaItems().findOne(id) as ExpectedMediaItem
		if (!item) throw new Error(`Could not find the updated item "${id}" in expectedMediaItems`)
		if (!this.shouldHandleItem(item)) return

		item = _.extend(_.omit(item, clearedFields), newFields) as ExpectedMediaItem
		if (item.lastSeen + (item.lingerTime || this.LINGER_TIME) < getCurrentTime()) {
			this.emit(
				'error',
				`An expected item was changed called "${item.label || item.path}", but it expired on ${new Date(
					item.lastSeen + (item.lingerTime || this.LINGER_TIME)
				)}. Ignoring.`
			)
			return
		}
		if (item.disabled) {
			this.emit('warn', `An expected item was added called "${item.label || item.path}", but it was disabled.`)
			return
		}
		const flow = this._handledFlows[item.mediaFlowId]

		if (!flow) {
			throw new Error(`Could not find mediaFlow "${item.mediaFlowId}" for expected media item "${item._id}"`)
		}
		if (!flow.destinationId) throw new Error(`Destination not set in flow "${flow.id}".`)

		const sourceStorage = this._storages.find(i => i.id === flow.sourceId)
		if (!sourceStorage) throw new Error(`Could not find source storage "${flow.sourceId}"`)

		let fileName: string
		try {
			fileName = sourceStorage.handler.parseUrl(item.url)
		} catch (e) {
			this.emit('error', `Assigned source storage "${sourceStorage.id}" does not support file "${item.url}"`)
			return
		}

		const baseObj: TrackedMediaItem = {
			_id: fileName,
			name: fileName,
			comment: item.label,
			expectedMediaItemId: [item._id],
			lastSeen: item.lastSeen,
			lingerTime: item.lingerTime || this.LINGER_TIME,
			sourceStorageId: flow.sourceId,
			targetStorageIds: [flow.destinationId]
		}

		this._trackedItems.getById(fileName).then(
			tracked => {
				if (tracked.sourceStorageId === flow.sourceId) {
					const update = _.extend(tracked, baseObj) as TrackedMediaItemDB
					this._trackedItems
						.upsert(tracked._id, (tmi?: TrackedMediaItem) => {
							if (tmi) {
								update.lastSeen = Math.max(update.lastSeen, tmi.lastSeen)
								update.lingerTime = Math.max(update.lingerTime, tmi.lingerTime)
								update.targetStorageIds = _.union(tmi.targetStorageIds, update.targetStorageIds)
								update.expectedMediaItemId = _.union(
									tmi.expectedMediaItemId || [],
									update.expectedMediaItemId || []
								)
							}
							return update
						})
						.then(() => this.checkAndEmitCopyWorkflow(update, 'onExpectedChanged, TMI existed'))
						.catch(e => {
							this.emit(`An error happened when trying to create a copy workflow`, e)
						})
				} else {
					this.emit(
						'warn',
						`File "${item.path}" is already tracked from a different source storage than "${flow.sourceId}".`
					)
				}
			},
			() => {
				this._trackedItems
					.put(baseObj)
					.then(() => this.checkAndEmitCopyWorkflow(baseObj, 'onExpectedChanged, TMI did not exist'))
					.catch(e => {
						this.emit(`An error happened when trying to create a copy workflow`, e)
					})
			}
		)
	}
	/** Called when an item is removed (from Core) */
	private onExpectedRemoved = (id: string, oldValue: any) => {
		this.emit('debug', `${id} was removed from Core expectedMediaItems collection`)

		let item: ExpectedMediaItem = oldValue || (this.expectedMediaItems().findOne(id) as ExpectedMediaItem)
		if (!item) throw new Error(`Could not find the new item "${id}" in expectedMediaItems`)

		if (!this.shouldHandleItem(item)) return

		const flow = this._allFlows.find(f => f.id === item.mediaFlowId)

		if (!flow) {
			throw new Error(`Could not find mediaFlow "${item.mediaFlowId}" for expected media item "${item._id}"`)
		}
		if (!flow.destinationId) throw new Error(`Destination not set in flow "${flow.id}".`)

		const storage = this._storages.find(i => i.id === flow.sourceId)
		if (!storage) throw new Error(`Could not find source storage "${flow.sourceId}"`)

		// add the file to the list of monitored files, if the storage is an 'onlySelectedFiles' storage
		if (storage.options.onlySelectedFiles) {
			try {
				storage.handler.removeMonitoredFile(storage.handler.parseUrl(item.url))
			} catch (e) {
				this.emit('error', `An exception occured when trying to remove monitoring for file "${item.url}": ${e}`)
				return
			}
		}
	}

	private getFile(fileName: string, sourceStorageId: string): Promise<File | undefined> {
		const sourceStorage = this._storages.find(i => i.id === sourceStorageId)
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
	/** Called whenever a file is added (or changed) in a storage */
	private onFileAdd = (st: StorageObject, e: StorageEvent) => {
		if (!e.file) throw new Error(`Event for file "${e.path}" has no file argument`)
		this._trackedItems
			.getById(e.path)
			.then(tracked => {
				if (tracked.sourceStorageId !== st.id) {
					throw new Error(`File "${e.path}" is already sourced from a different storage.`)
				}

				this._allStorages
					.filter(i => tracked.targetStorageIds.indexOf(i.id) >= 0)
					.forEach(target =>
						this.emitCopyWorkflow(
							e.file as File,
							target,
							tracked.comment,
							'Monitored file was added to source storage'
						)
					)
			})
			.catch(e => {
				this.emit(
					'debug',
					`File "${e.path}" has been added to a monitored filesystem, but is not expected yet.`
				)
			})
	}

	private onFileChange = this.onFileAdd
	/** Called whenever a file is deleted in a storage */
	private onFileDelete = (st: StorageObject, e: StorageEvent) => {
		this._trackedItems
			.getById(e.path)
			.then(tracked => {
				if (tracked.sourceStorageId === st.id) {
					this.emit('warn', `File "${e.path}" has been deleted from source storage "${st.id}".`)
				}
			})
			.catch(_e => {})
	}

	protected cronJob() {
		this.emit('debug', `Starting cron job for ${this.constructor.name}`)
		this.purgeOldExpectedItems()
			.then(() => {
				this.emit('debug', `Doing expected items storage check`)
				this._storages.forEach(i => this.expectedStorageCheck(i, true))
			})
			.catch(e => {
				this.emit('error', `There was an error running the cron job`, e)
			})
	}

	protected registerSourceStorage(st: StorageObject) {
		this.emit('debug', `Registering source storage: "${st.id}" in ${this.constructor.name}`)
		st.handler.on(StorageEventType.add, (e: StorageEvent) => this.onFileAdd(st, e))
		st.handler.on(StorageEventType.change, (e: StorageEvent) => this.onFileChange(st, e))
		st.handler.on(StorageEventType.delete, (e: StorageEvent) => this.onFileDelete(st, e))

		this._storages.push(st)

		this.initialStorageCheck(st)
			.then(() => {
				this.emit('debug', `Initial ${this.constructor.name} scan for "${st.id}" complete.`)
			})
			.catch(e => {
				this.emit('debug', `Initial ${this.constructor.name} scan for "${st.id}" failed.`, e)
			})
	}

	protected async initialStorageCheck(st: StorageObject): Promise<void> {
		return this.expectedStorageCheck(st)
	}

	protected async expectedStorageCheck(st: StorageObject, withDelay?: boolean): Promise<void> {
		const tmis = await this._trackedItems.getAllFromStorage(st.id)
		tmis.forEach(item => this.checkAndEmitCopyWorkflow(item, 'expectedStorageCheck', withDelay))
	}
	/**
	 * Checks all expectedMediaItems, makes sure that we're tracking them, and starts any work that might be due
	 */
	protected async initialExpectedCheck(): Promise<void> {
		const handledIds = _.keys(this._handledFlows)
		const currentExpectedContents = this.expectedMediaItems().find((item: ExpectedMediaItem) => {
			return handledIds.indexOf(item.mediaFlowId) >= 0
		}) as ExpectedMediaItem[]
		const expectedItems: TrackedMediaItem[] = []
		currentExpectedContents.forEach(i => {
			const flow = this._handledFlows[i.mediaFlowId]
			if (!flow) return
			if (!flow.destinationId) {
				this.emit('error', `Media flow "${flow.id}" does not have a destinationId`)
				return
			}

			const sourceStorage = this._storages.find(i => i.id === flow.sourceId)
			if (!sourceStorage) throw new Error(`Could not find source storage "${flow.sourceId}"`)

			let fileName: string
			try {
				fileName = sourceStorage.handler.parseUrl(i.url)
			} catch (e) {
				this.emit('error', `Assigned source storage "${sourceStorage.id}" does not support file "${i.url}"`)
				return
			}

			if (i.lastSeen + (i.lingerTime || this.LINGER_TIME) < getCurrentTime()) {
				this.emit(
					'warn',
					`Ignoring an expectedMediaItem "${i.url}" since it's expiration date was ${new Date(
						i.lastSeen + (i.lingerTime || this.LINGER_TIME)
					)}`
				)
				return
			}

			const expectedItem = literal<TrackedMediaItem>({
				_id: fileName,
				name: fileName,
				comment: i.label,
				lastSeen: i.lastSeen,
				lingerTime: i.lingerTime || this.LINGER_TIME,
				expectedMediaItemId: [i._id],
				sourceStorageId: flow.sourceId,
				targetStorageIds: [flow.destinationId]
			})

			// check if an item doesn't already exist in the list with the same id
			const overlapItem = expectedItems.find(i => i._id === expectedItem._id)
			if (overlapItem) {
				if (overlapItem.sourceStorageId === expectedItem.sourceStorageId) {
					overlapItem.targetStorageIds = _.union(overlapItem.targetStorageIds, expectedItem.targetStorageIds)
					overlapItem.lastSeen = Math.max(expectedItem.lastSeen, overlapItem.lastSeen)
					overlapItem.lingerTime = Math.max(expectedItem.lingerTime, overlapItem.lingerTime)
					overlapItem.expectedMediaItemId = _.union(
						overlapItem.expectedMediaItemId || [],
						expectedItem.expectedMediaItemId || []
					)
				} else {
					this.emit(
						'error',
						`Only a single item of a given name can be expected across all sources. Item "${expectedItem.name}" is expected from multiple sources: "${expectedItem.sourceStorageId}" & "${overlapItem.sourceStorageId}."`
					)
				}
			} else {
				expectedItems.push(expectedItem)
			}
		})
		Promise.all(this._storages.map(s => this._trackedItems.getAllFromStorage(s.id)))
			.then(result => {
				const allTrackedFiles = _.flatten(result) as TrackedMediaItemDB[]
				const newItems = _.compact(
					expectedItems.map(i => {
						return allTrackedFiles.find(j => j.expectedMediaItemId === i.expectedMediaItemId) ? null : i
					})
				)
				this._trackedItems
					.bulkChange(newItems)
					.then(() => {
						return newItems.map(item => this.checkAndEmitCopyWorkflow(item, 'initialExpectedCheck'))
					})
					.catch(e => {
						this.emit('error', `There has been an error writing to tracked items database`, e)
					})
			})
			.catch(_e => {
				this.emit('error')
			})
	}
	/**
	 * Goes through the list of expected items and removes them if they are stale and too old (older than lingerTime)
	 */
	protected purgeOldExpectedItems(): Promise<void> {
		this.emit('debug', `Purging old expected items`)
		return Promise.all(this._storages.map(s => this._trackedItems.getAllFromStorage(s.id))).then(result => {
			const allTrackedFiles = _.flatten(result) as TrackedMediaItemDB[]
			const toBeDeleted = allTrackedFiles
				.filter(i => i.lastSeen + i.lingerTime < getCurrentTime())
				.map(i => {
					this.emit(
						'debug',
						`Marking file "${i.name}" coming from "${
							i.sourceStorageId
						}" to be deleted because it was last seen ${new Date(
							i.lastSeen
						)} & linger time is ${i.lingerTime / (60 * 60 * 1000)} hours`
					)
					return _.extend(i, {
						_deleted: true
					})
				})
			return Promise.all(
				toBeDeleted.map((i: TrackedMediaItemDB) => {
					return Promise.all(
						this._allStorages
							// get only storages that contain the file as a target storage
							.filter(j => i.targetStorageIds.indexOf(j.id) >= 0)
							// remove the file from all the storages that contain it as a target
							.map(j =>
								j.handler
									.getFile(i.name)
									.then(f =>
										retryNumber(() => j.handler.deleteFile(f), this.RETRY_COUNT, this.RETRY_TIMEOUT)
											.then(() => true)
											.catch(e => {
												this.emit(
													'warn',
													`File "${i.name}" could not be deleted from source storage "${j.id}" after ${this.RETRY_COUNT} retries`,
													e
												)
												return false
											})
									)
									.catch(e => {
										this.emit(
											'warn',
											`File "${i.name}" could not be found on source storage "${j.id}"`,
											e
										)
										return false
									})
							)
					)
						.then(() => this._trackedItems.remove(i))
						.then(() => this.emit('debug', `Stopped tracking file "${i.name}".`))
				})
			).then(results => {
				this.emit('info', `Removed ${results.length} expired expected items.`)
			})
		})
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
			}),
			new ScannerWorkStep({
				action: WorkStepAction.GENERATE_METADATA,
				file,
				target: st,
				priority: 1,
				status: WorkStepStatus.IDLE
			}),
			new ScannerWorkStep({
				action: WorkStepAction.GENERATE_THUMBNAIL,
				file,
				target: st,
				priority: 0.5,
				status: WorkStepStatus.IDLE
			}),
			new ScannerWorkStep({
				action: WorkStepAction.GENERATE_PREVIEW,
				file,
				target: st,
				priority: 0.3,
				status: WorkStepStatus.IDLE
			})
		]
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
				source: WorkFlowSource.EXPECTED_MEDIA_ITEM,
				steps: this.generateNewFileWorkSteps(file, targetStorage),
				created: getCurrentTime(),
				success: false
			}),
			this
		)
		this.emit('debug', `New forkflow started for "${file.name}": "${workflowId}". ${reason.join(', ')}`)
	}
	/**
	 * Checks if the item exists on the storage and issues workflows
	 * @param tmi
	 */
	protected checkAndEmitCopyWorkflow(tmi: TrackedMediaItem, reason: string, withRetry?: boolean) {
		if (!tmi.sourceStorageId) throw new Error(`Tracked Media Item "${tmi._id}" has no source storage!`)
		const storage = this._storages.find(i => i.id === tmi.sourceStorageId)
		if (!storage) throw new Error(`Could not find storage "${tmi.sourceStorageId}"`)
		if (tmi.lastSeen + tmi.lingerTime < getCurrentTime()) {
			this.emit(
				'warn',
				`Ignoring new WorkFlow for file "${tmi.name}" since it's expiration date is ${new Date(
					tmi.lastSeen + tmi.lingerTime
				)}`
			)
			return
		}

		// add the file to the list of monitored files, if the storage is an 'onlySelectedFiles' storage
		if (storage.options.onlySelectedFiles) {
			storage.handler.addMonitoredFile(tmi.name)
		}

		// get file from source storage
		this.getFile(tmi.name, tmi.sourceStorageId)
			.then(file => {
				if (file && storage) {
					file.getProperties()
						.then(sFileProps => {
							this._allStorages
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
													this.emit(
														'error',
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
											if (withRetry) {
												setTimeout(() => {
													this.emit(
														'debug',
														`Retrying a check for a "${tmi.name}" file that wasn't found on target storage "${i.id}"`
													)
													this.checkAndEmitCopyWorkflow(tmi, reason)
												}, 60 * 1000)
											} else {
												this.emitCopyWorkflow(
													file,
													i,
													tmi.comment,
													reason,
													`File not found on target storage`
												)
											}
										}
									)
								})
						})
						.catch(e => {
							this.emit('error', `Could not fetch file "${tmi.name}" properties from storage`, e)
						})
				} else {
					this.emit('debug', `File "${tmi.name}" not found in source storage "${tmi.sourceStorageId}".`)
				}
			})
			.catch(e => {
				this.emit(
					'error',
					`File "${tmi.name}" failed to be checked in source storage "${tmi.sourceStorageId}"`,
					e
				)
			})
	}
}
