export * from './api/mediaObject'

/** The settings in Core (that's gonna be in the UI) */
export interface DeviceSettings {
	/** A list of available storage locations */
	storages: Array<StorageSettings>

	/** A specification of source -> target mappings with workflow generators to be attached to them */
	mediaFlows: Array<MediaFlow>

	/** The amount of workers to be available for file system operations */
	workers: number

	/** How long to wait before removing a file - used by some workflow generators */
	lingerTime: number

	/** Cron job time - how often to check the file system for consistency - do a poll of the filesystem to check that the files are where they are supposed to be, clean out expired files */
	cronJobTime?: number

	/** WorkFlow cleanup time */
	workFlowLingerTime?: number

	/** When to warn that the Queue is too long */
	warningWFQueueLength?: number
	/** When to warn that a worker is working too long */
	warningTaskWorkingTime?: number

	/** Connection details for the media scanner */
	mediaScanner: {
		host?: string
		port: number
	}
	/** A list of Monitors, which will monitor media statuses */
	monitors?: {
		[monitorId: string]: MonitorSettings
	}
}

export type Time = number // Timestamp, unix time in ms
export type Duration = number // Duration, in ms
/**
 * An item expected by the Core to exist
 */
export interface ExpectedMediaItem {
	_id: string

	/** Source label that can be used to identify the EMI */
	label?: string

	/** Local path to the media object */
	path: string

	/** Global path to the media object */
	url: string

	/** The rundown id that is the source of this MediaItem */
	rundownId: string

	/** The part id that is the source of this Media Item */
	partId: string

	/** The studio installation this ExpectedMediaItem was generated in */
	studioId: string

	/** True if the media item has been marked as possibly unavailable */
	disabled: boolean

	/** A label defining a pool of resources */
	mediaFlowId: string

	/** The last time the object was seen / used in Core */
	lastSeen: Time

	/** Time to wait before removing file */
	lingerTime?: Duration
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
	FILE_SHARE = 'file_share',
	QUANTEL_HTTP = 'quantel_http'
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
	options: {
		/** Only subscribed files can be listened to for changes */
		onlySelectedFiles?: boolean
		[key: string]: any
	}
}

export interface QuantelHTTPStorage extends StorageSettings {
	type: StorageType.QUANTEL_HTTP
	options: {
		transformerUrl: string
		gatewayUrl: string
		ISAUrl: string
		zoneId: string | undefined
		serverId: number
		onlySelectedFiles: true
	}
}

export interface LocalFolderStorage extends StorageSettings {
	type: StorageType.LOCAL_FOLDER
	options: {
		basePath: string
		mediaPath?: string
		usePolling?: boolean
		onlySelectedFiles?: boolean
	}
}
export interface FileShareStorage extends StorageSettings {
	type: StorageType.FILE_SHARE
	options: {
		/** URI to the network share, eg "\\somehting\share" */
		basePath: string
		/** A folder prefix relative to the Playout media folder */
		mediaPath?: string
		/** A virtual local drive letter, "E", the basePath should be mounted to */
		mappedNetworkedDriveTarget: string
		username?: string // wip?
		password?: string // wip?
		onlySelectedFiles?: boolean
	}
}

export interface WorkFlow {
	_id: string

	name?: string
	/** A secondary name, some kind of a comment about the workFlow */
	comment?: string

	source: WorkFlowSource
	/** Id of the expectedMedia Item */
	expectedMediaItemId?: string[]
	mediaObjectId?: string
	steps: Array<WorkStep>
	created: Time

	priority: number

	finished: boolean
	success: boolean

	modified?: Time
}

export interface WorkFlowDB extends WorkFlow {
	steps: never
	hash: string
	_rev: string
}

export enum WorkFlowSource {
	EXPECTED_MEDIA_ITEM = 'expected_media_item',
	SOURCE_STORAGE_REMOVE = 'source_storage_remove',
	LOCAL_MEDIA_ITEM = 'local_media_item',
	TARGET_STORAGE_REMOVE = 'local_storage_remove'
}

export interface WorkStepInitial {
	action: WorkStepAction
	status: WorkStepStatus
	messages?: Array<string>
	modified?: Time

	priority: number
	/** 0-1 */
	progress?: number
	/** If this step is critical */
	criticalStep?: boolean
	/** Calculated time left of this step */
	expectedLeft?: Duration
}

/**
 * A Workstep represents an action that is to be performed
 */
export abstract class WorkStep implements WorkStepInitial {
	action: WorkStepAction
	status: WorkStepStatus
	messages?: Array<string>
	modified?: Time

	priority: number
	/** 0-1 */
	progress?: number
	/** If this step is key (mission critical) */
	criticalStep?: boolean
	/** Calculated time left of this step */
	expectedLeft?: Duration

	constructor(init?: WorkStepInitial) {
		Object.assign(this, init)
	}
}

export enum WorkStepStatus {
	IDLE = 'idle',
	WORKING = 'working',
	DONE = 'done',
	ERROR = 'error',
	CANCELED = 'canceled',
	SKIPPED = 'skipped',
	BLOCKED = 'blocked'
}

export enum WorkStepAction {
	COPY = 'copy',
	DELETE = 'delete',
	SCAN = 'scan',
	GENERATE_PREVIEW = 'generate_preview',
	GENERATE_THUMBNAIL = 'generate_thumbnail',
	GENERATE_METADATA = 'generate_metadata'
}

export type MonitorSettings = MonitorSettingsNull | MonitorSettingsMediaScanner | MonitorSettingsQuantel
export interface MonitorSettingsBase {
	type: MonitorSettingsType

	/** The storageId is defining the storage/server on which the media is on.
	 * (in the media-scanner, this is equivalent to the collectionId)
	 */
	storageId: string
	disable?: boolean
}
export enum MonitorSettingsType {
	NULL = '',
	MEDIA_SCANNER = 'mediascanner',
	QUANTEL = 'quantel'
}
export interface MonitorSettingsNull extends MonitorSettingsBase {
	type: MonitorSettingsType.NULL
}
export interface MonitorSettingsMediaScanner extends MonitorSettingsBase {
	type: MonitorSettingsType.MEDIA_SCANNER
	/** Host of the media-scanner PouchDB server */
	host: string
	port: number
}
export interface MonitorSettingsQuantel extends MonitorSettingsBase {
	type: MonitorSettingsType.QUANTEL

	/** Url to the quantel gateway  */
	gatewayUrl: string
	/** Address to the ISA, for the gateway to connect to */
	ISAUrl: string
	/** The ID of the zone to use. If omitted, will be using "default" */
	zoneId?: string
	/** The id of the server to control. An Ingeter */
	serverId: number
}
