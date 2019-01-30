import * as _ from 'underscore'
import * as Winston from 'winston'
import { BaseWorkFlowGenerator, WorkFlowGeneratorEventType } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

import { CoreHandler } from '../coreHandler'
import { ExpectedMediaItem, MediaFlow, MediaFlowType, WorkFlowSource, WorkStepAction, WorkStep, WorkFlow } from '../api'
import { TrackedMediaItems, TrackedMediaItemDB, TrackedMediaItem } from '../mediaItemTracker'
import { StorageObject, StorageEventType, File, StorageEvent } from '../storageHandlers/storageHandler'
import { Collection } from 'tv-automation-server-core-integration'
import { randomId, literal, getCurrentTime } from '../lib/lib'
import { FileWorkStep, ScannerWorkStep } from '../work/workStep'

export class ExpectedItemsGenerator extends BaseWorkFlowGenerator {
	private _coreHandler: CoreHandler
	private _tracked: TrackedMediaItems
	private _availableStorage: StorageObject[]
	private _storage: StorageObject[] = []
	private _flows: MediaFlow[] = []
	private _handledFlows: MediaFlow[] = []
	logger: Winston.LoggerInstance

	private expectedMediaItems: Collection
	private observer: any

	private _cronJob: NodeJS.Timer

	private _expectedMediaItemsSub: string

	private CRON_JOB_INTERVAL = 10 * 60 * 60 * 1000

	private LINGER_TIME = 3 * 24 * 60 * 60 * 1000

	constructor (availableStorage: StorageObject[], tracked: TrackedMediaItems, flows: MediaFlow[], coreHandler: CoreHandler, lingerTime?: number, cronJobTime?: number) {
		super()
		this._availableStorage = availableStorage
		this._coreHandler = coreHandler
		this._tracked = tracked
		this._flows = flows

		this.LINGER_TIME = lingerTime || this.LINGER_TIME
		this.CRON_JOB_INTERVAL = cronJobTime || this.CRON_JOB_INTERVAL
	}

	async init (): Promise<void> {
		return Promise.resolve().then(() => {
			this._flows.forEach((item) => {
				if (item.mediaFlowType === MediaFlowType.EXPECTED_ITEMS) {
					const storage = this._availableStorage.find(i => i.id === item.sourceId)
					if (!storage) {
						this.emit('debug', `Storage "${item.sourceId}" could not be found among available storage.`)
						return
					}

					this._handledFlows.push(item)

					this.registerStorage(storage)
				}
			})

			this._coreHandler.core.onConnected(() => {
				this.setupSubscribtionsAndObservers().catch((e) => {
					this.emit('error', `Error while resetting the subscribtions: ${e}`)
				})
			})

			return this.setupSubscribtionsAndObservers()
		})
	}

	async setupSubscribtionsAndObservers (): Promise<void> {
		if (this._expectedMediaItemsSub) {
			this._coreHandler.core.unsubscribe(this._expectedMediaItemsSub)
		}
		this._expectedMediaItemsSub = await this._coreHandler.core.subscribe('expectedMediaItems', {
			mediaFlowId: {
				$in: this._handledFlows.map(i => i.id)
			}
		})
		this.emit('debug', 'Subscribed to expectedMediaItems.')

		this.expectedMediaItems = this._coreHandler.core.getCollection('expectedMediaItems')

		const observer = this._coreHandler.core.observe('expectedMediaItems')
		observer.added = this.onExpectedAdded
		observer.changed = this.onExpectedChanged
		observer.removed = this.onExpectedRemoved

		this.observer = observer

		this.emit('debug', 'Observer set up')

		this._cronJob = setInterval(() => {
			this.cronJob()
		}, this.CRON_JOB_INTERVAL)
		return this.initialExpectedCheck()
	}

	async destroy (): Promise<void> {
		return Promise.resolve().then(() => {
			this._coreHandler.core.unsubscribe(this._expectedMediaItemsSub)
			clearInterval(this._cronJob)
			this.observer.stop()
		})
	}

	private onExpectedAdded = (id: string) => {
		const item = this.expectedMediaItems.findOne(id) as ExpectedMediaItem
		const flow = this._flows.find((f) => f.id === item.mediaFlowId)

		if (!flow) throw new Error(`Could not find mediaFlow "${item.mediaFlowId}" for expected media item "${item._id}"`)
		if (!flow.destinationId) throw new Error(`Destination not set in flow "${flow.id}".`)

		const baseObj = {
			_id: item.path,
			name: item.path,
			expectedMediaItemId: [ item._id ],
			lastSeen: item.lastSeen,
			lingerTime: item.lingerTime || this.LINGER_TIME,
			sourceStorageId: flow.sourceId,
			targetStorageIds: [flow.destinationId]
		}
		this._tracked.put(baseObj).then(() => this.checkAndEmitCopyWorkflow(baseObj)).catch((e) => {
			this.emit('error', `An error happened when trying to create a copy workflow: ${e}`)
		})
	}

	private onExpectedChanged = (id: string, _oldFields: any, _clearedFields: any, _newFields: any) => {
		const item = this.expectedMediaItems.findOne(id) as ExpectedMediaItem
		const flow = this._flows.find((f) => f.id === item.mediaFlowId)

		if (!flow) throw new Error(`Could not find mediaFlow "${item.mediaFlowId}" for expected media item "${item._id}"`)
		if (!flow.destinationId) throw new Error(`Destination not set in flow "${flow.id}".`)

		const baseObj = {
			_id: item.path,
			name: item.path,
			expectedMediaItemId: [ item._id ],
			lastSeen: item.lastSeen,
			lingerTime: item.lingerTime || this.LINGER_TIME,
			sourceStorageId: flow.sourceId,
			targetStorageIds: [flow.destinationId]
		}

		this._tracked.getById(item.path).then((tracked) => {
			if (tracked.sourceStorageId === flow.sourceId) {
				const update = _.extend(tracked, baseObj)
				this._tracked.put(update).then(() => this.checkAndEmitCopyWorkflow(update)).catch((e) => {
					this.emit(`An error happened when trying to create a copy workflow: ${e}`)
				})
			} else {
				this.emit('warn', `File "${item.path}" is already tracked from a different source storage than "${flow.sourceId}".`)
			}
		}, () => {
			this._tracked.put(baseObj).then(() => this.checkAndEmitCopyWorkflow(baseObj)).catch((e) => {
				this.emit(`An error happened when trying to create a copy workflow: ${e}`)
			})
		})
	}

	private onExpectedRemoved = (id: string, _oldValue: any) => {
		this.emit('debug', `${id} was removed from Core expectedMediaItems collection`)
	}

	private getFile (fileName: string, sourceStorageId: string): Promise<File | undefined> {
		const sourceStorage = this._storage.find(i => i.id === sourceStorageId)
		if (!sourceStorage) throw new Error(`Source storage "${sourceStorageId}" could not be found.`)

		return new Promise<File | undefined>((resolve, _reject) => {
			sourceStorage.handler.getFile(fileName).then((file) => {
				resolve(file)
			}, (_reason) => {
				resolve(undefined)
			})
		})
	}

	private onFileAdd = (st: StorageObject, e: StorageEvent) => {
		if (!e.file) throw new Error(`Event for file "${e.path}" has no file argument`)
		this._tracked.getById(e.path).then((tracked) => {
			if (tracked.sourceStorageId !== st.id) throw new Error(`File "${e.path}" is already sourced from a different storage.`)

			this._availableStorage.filter(i => tracked.targetStorageIds.indexOf(i.id) >= 0)
			.forEach(target => this.emitCopyWorkflow(e.file as File, target))
		}).catch((e) => {
			this.emit('debug', `File "${e.path}" has been added to a monitored filesystem, but is not expected yet.`)
		})
	}

	private onFileChange = this.onFileAdd

	private onFileDelete = (st: StorageObject, e: StorageEvent) => {
		this._tracked.getById(e.path).then((tracked) => {
			if (tracked.sourceStorageId === st.id) {
				this.emit('warn', `File "${e.path}" has been deleted from source storage "${st.id}".`)
			}
		}).catch((_e) => { })
	}

	protected cronJob () {
		this.emit('debug', `Starting cron job for ${this.constructor.name}`)
		this.emit('debug', `Purging old expected items`)
		this.purgeOldExpectedItems().then(() => {
			this.emit('debug', `Doing expected items storage check`)
			this._storage.forEach((i) => this.expectedStorageCheck(i))
		}).catch((e) => {
			this.emit('error', `There was an error running the cron job: ${e}`)
		})
	}

	protected registerStorage (st: StorageObject) {
		this.emit('debug', `Registering storage: "${st.id}" in ${this.constructor.name}`)
		st.handler.on(StorageEventType.add, (e: StorageEvent) => this.onFileAdd(st, e))
		st.handler.on(StorageEventType.change, (e: StorageEvent) => this.onFileChange(st, e))
		st.handler.on(StorageEventType.delete, (e: StorageEvent) => this.onFileDelete(st, e))

		this._storage.push(st)

		this.initialStorageCheck(st).then(() => {
			this.emit('debug', `Initial ${this.constructor.name} scan for "${st.id}" complete.`)
		}).catch((e) => {
			this.emit('debug', `Initial ${this.constructor.name} scan for "${st.id}" failed: ${e}.`)
		})
	}

	protected async initialStorageCheck (st: StorageObject): Promise<void> {
		return this.expectedStorageCheck(st)
	}

	protected async expectedStorageCheck (st: StorageObject): Promise<void> {
		const tmis = await this._tracked.getAllFromStorage(st.id)
		tmis.forEach((item) => this.checkAndEmitCopyWorkflow(item))
	}

	protected async initialExpectedCheck (): Promise<void> {
		const handledIds = this._handledFlows.map(i => i.id)
		const currentExpectedContents = this.expectedMediaItems.find((item: ExpectedMediaItem) => {
			return handledIds.indexOf(item.mediaFlowId) >= 0
		}) as ExpectedMediaItem[]
		const expectedItems: TrackedMediaItem[] = []
		currentExpectedContents.forEach((i) => {
			const flow = this._handledFlows.find((j) => j.id === i.mediaFlowId)
			if (!flow) return
			if (!flow.destinationId) {
				this.emit('error', `Media flow "${flow.id}" does not have a destinationId`)
				return
			}
			const expectedItem = literal<TrackedMediaItem>({
				_id: i.path,
				name: i.path,
				lastSeen: i.lastSeen,
				lingerTime: i.lingerTime || this.LINGER_TIME,
				expectedMediaItemId: [ i._id ],
				sourceStorageId: flow.sourceId,
				targetStorageIds: [ flow.destinationId ]
			})

			// check if an item doesn't already exist in the list with the same id
			const overlapItem = expectedItems.find(i => i._id === expectedItem._id)
			if (overlapItem) {
				if ((overlapItem.sourceStorageId === expectedItem.sourceStorageId)) {
					overlapItem.targetStorageIds = _.union(overlapItem.targetStorageIds, expectedItem.targetStorageIds)
					overlapItem.lastSeen = Math.max(expectedItem.lastSeen, overlapItem.lastSeen)
					overlapItem.lingerTime = Math.max(expectedItem.lingerTime, overlapItem.lingerTime)
					overlapItem.expectedMediaItemId = _.union(overlapItem.expectedMediaItemId || [], expectedItem.expectedMediaItemId || [])
				} else {
					this.emit('error', `Only a single item of a given name can be expected across all sources. Item "${expectedItem.name}" is expected from multiple sources: "${expectedItem.sourceStorageId}" & "${overlapItem.sourceStorageId}."`)
				}
			} else {
				expectedItems.push(expectedItem)
			}
		})
		Promise.all(this._storage.map((s) => this._tracked.getAllFromStorage(s.id)))
		.then((result) => {
			const allTrackedFiles = _.flatten(result) as TrackedMediaItemDB[]
			const newItems = _.compact(expectedItems.map((i) => {
				return allTrackedFiles.find(j => j.expectedMediaItemId === i.expectedMediaItemId) ? null : i
			}))
			this._tracked.bulkChange(newItems).then(() => {
				return newItems.map(item => this.checkAndEmitCopyWorkflow(item))
			}).catch((e) => {
				this.emit('error', `There has been an error writing to tracked items database: ${e}`)
			})
		}).catch((_e) => {
			this.emit('error')
		})
	}

	protected purgeOldExpectedItems (): Promise<void> {
		return Promise.all(this._storage.map((s) => this._tracked.getAllFromStorage(s.id)))
		.then((result) => {
			const allTrackedFiles = _.flatten(result) as TrackedMediaItemDB[]
			const toBeDeleted = allTrackedFiles.filter(i => ((i.lastSeen + i.lingerTime) < getCurrentTime())).map((i) => {
				this.emit('debug', `Marking file "${i.name}" coming from "${i.sourceStorageId}" to be deleted because it was last seen ${new Date(i.lastSeen)} & linger time is ${i.lingerTime / (60 * 60 * 1000)} hours`)
				return _.extend(i, {
					_deleted: true
				})
			})
			return Promise.all(toBeDeleted.map((i: TrackedMediaItemDB) => {
				return Promise.all(this._availableStorage
				// get only storages that contain the file as a target storage
				.filter(j => (i.targetStorageIds.indexOf(j.id) >= 0))
				// remove the file from all the storages that contain it as a target
				.map((j) => j.handler.getFile(i.name).then((f) => j.handler.deleteFile(f))))
				.then(() => this._tracked.remove(i))
				.then(() => this.emit('debug', `Stopped tracking file "${i.name}".`))
			})).then((results) => {
				this.emit('info', `Removed ${results.length} expired expected items.`)
			})
		})
	}

	protected generateNewFileWorkSteps (file: File, st: StorageObject): WorkStep[] {
		return [
			new FileWorkStep({
				action: WorkStepAction.COPY,
				file: file,
				target: st,
				priority: 2
			}),
			new ScannerWorkStep({
				action: WorkStepAction.GENERATE_THUMBNAIL,
				file,
				target: st,
				priority: 0.5
			}),
			new ScannerWorkStep({
				action: WorkStepAction.GENERATE_PREVIEW,
				file,
				target: st,
				priority: 0.3
			})
		]
	}

	protected emitCopyWorkflow (file: File, targetStorage: StorageObject) {
		const workflowId = file.name + '_' + randomId()
		this.emit(WorkFlowGeneratorEventType.NEW_WORKFLOW, literal<WorkFlow>({
			_id: workflowId,
			finished: false,
			priority: 1,
			source: WorkFlowSource.EXPECTED_MEDIA_ITEM,
			steps: this.generateNewFileWorkSteps(file, targetStorage),
			created: getCurrentTime(),
			success: false
		}), this)
		this.emit('debug', `New forkflow started for "${file.name}": "${workflowId}".`)
	}

	protected checkAndEmitCopyWorkflow (tmi: TrackedMediaItem) {
		if (!tmi.sourceStorageId) throw new Error(`Tracked Media Item "${tmi._id}" has no source storage!`)
		const storage = this._storage.find(i => i.id === tmi.sourceStorageId)
		if (!storage) throw new Error(`Could not find storage "${tmi.sourceStorageId}"`)
		// get file from source storage
		this.getFile(tmi.name, tmi.sourceStorageId).then((file) => {
			if (file && storage) {
				file.getProperties().then((sFileProps) => {
					this._availableStorage.filter(i => tmi.targetStorageIds.indexOf(i.id) >= 0)
					.forEach((i) => {
						// check if the file exists on the target storage
						i.handler.getFile(tmi.name).then((rFile) => {
							// the file exists on target storage
							rFile.getProperties().then((rFileProps) => {
								if (rFileProps.size !== sFileProps.size) {
									// File size doesn't match
									this.emitCopyWorkflow(file, i)
								}
							}, (e) => {
								// Properties could not be fetched
								this.emit('error', `File "${tmi.name}" exists on storage "${i.id}", but it's properties could not be checked: ${e}. Attempting to write over.`)
								this.emitCopyWorkflow(file, i)
							})
						}, (_err) => {
							// the file not found
							this.emitCopyWorkflow(file, i)
						})
					})
				}).catch((e) => {
					this.emit('error', `Could not fetch file "${tmi.name}" properties from storage: ${e}`)
				})
			} else {
				this.emit('debug', `File "${tmi.name}" not found in source storage "${tmi.sourceStorageId}".`)
			}
		}).catch((e) => {
			this.emit('error', `File "${tmi.name}" failed to be checked in source storage "${tmi.sourceStorageId}": ${e}`)
		})
	}

}
