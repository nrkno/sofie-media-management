export * from './api/mediaObject'

/** The settings in Core (that's gonna be in the UI) */
export interface DeviceSettings {
	storages: Array<StorageSettings>
	mediaFlows: Array<MediaFlow>
	workers: number
}

/**
 * Get the expected clips from Core
 */
export type CoreCallGetExpectedMediaItems = (deviceId: string, token: string) => Array<ExpectedMediaItem>

export type Time = number // Timestamp, unix time in ms
export type Duration = number // Duration, in ms
/**
 * An item expected by the Core to exist
 */
export interface ExpectedMediaItem {
	_id: string
	/** Local path to the media object */
	path: string

	/** True if the media item has been marked as possibly unavailable */
	disabled: boolean

	/** A label defining a pool of resources */
	mediaFlowId: string

	/** The last time the object was seen / used in Core */
	lastSeen: Time

	/** Time to wait before removing file */
	lingerTime: Duration
}

export enum MediaFlowType {
	WATCH_FOLDER = 'watch_folder',
	LOCAL_INGEST = 'local_ingest',
	EXPECTED_ITEMS = 'expected_items'
}

export interface MediaFlow {
	/** Id of the mediaFlow */
	id: string
	/** Id of a Storage */
	sourceId: string
	/** Id of a Storage */
	destinationId?: string
	/** Workflow generator type */
	mediaFlowType: MediaFlowType
}

export enum StorageType {
	LOCAL_FOLDER = 'local_folder',
	FILE_SHARE = 'file_share'
	// FTP = 'ftp',
	// AWS_S3 = 'aws_s3'
}
export interface StorageSettings {
	id: string
	support: {
		read: boolean
		write: boolean
	}
	type: StorageType
	options: any
}
export interface LocalFolderStorage extends StorageSettings {
	type: StorageType.LOCAL_FOLDER
	options: {
		basePath: string
	}
}
export interface FileShareStorage extends StorageSettings {
	type: StorageType.FILE_SHARE
	options: {
		/** URI to the network share, eg "\\somehting\share" */
		basePath: string
		/** A virtual local drive letter, "E", the basePath should be mounted to */
		mappedNetworkedDriveTarget: string
		username?: string // wip?
		password?: string // wip?
	}
}

export interface WorkFlow {
	_id: string

	source: WorkFlowSource
	/** Id of the expectedMedia Item */
	expectedMediaItemId?: string
	mediaObjectId?: string
	steps: Array<WorkStepBase>
	created: Time

	priority: number

	finished: boolean
	success: boolean
}

export interface WorkFlowDB extends WorkFlow {
	steps: never
}

export enum WorkFlowSource {
	EXPECTED_MEDIA_ITEM = 'expected_media_item',
	SOURCE_STORAGE_REMOVE = 'source_storage_remove',
	LOCAL_MEDIA_ITEM = 'local_media_item',
	TARGET_STORAGE_REMOVE = 'local_storage_remove'
}

export abstract class WorkStepBase {
	action: WorkStepAction
	status: WorkStepStatus
	messages?: Array<string>

	priority: number
	/** 0-1 */
	progress?: number
	/** Calculated time left of this step */
	expectedLeft?: Duration

	constructor (init?: Partial<WorkStepBase>) {
		Object.assign(this, init)
	}
}

export enum WorkStepStatus {
	IDLE = 'idle',
	WORKING = 'working',
	DONE = 'done',
	ERROR = 'error',
	CANCELED = 'canceled',
	BLOCKED = 'blocked'
}

export enum WorkStepAction {
	COPY = 'copy',
	DELETE = 'delete',
	GENERATE_THUMBNAIL = 'generate_thumbnail',
	GENERATE_METADATA = 'generate_metadata'
}
