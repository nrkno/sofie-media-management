export * from './api/mediaObject'
import { WatchOptions } from 'chokidar'

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

	/** Connection details for media access via HTTP server */
	httpPort?: number
	/** Connection details for media access via HTTPS server */
	httpsPort?: number

	/** A list of Monitors, which will monitor media statuses */
	monitors?: {
		[monitorId: string]: MonitorSettings
	}

	/** Local path configuration for media manager system */
	paths?: {
		/** Cammand to execute to run `ffmpeg` */
		ffmpeg?: string
		/** Command to execute to run `ffprobe` */
		ffprobe?: string
		/** Folder to store generated resources. Defaults to where media manager is started */
		resources?: string
	}

	/** Configuration of thumbnail size */
	thumbnails?: {
		/** Width of thumbnail in pixels. Default is `256` */
		width?: number
		/** Height of thumbnail in pixels. Set height to `-1` - the default - to preserve aspect */
		height?: number
		/** Sub-folder of `paths.resources` where thumbnails are stored. Defaults to `.../thumbnails` */
		folder?: string // Not in use yet
	}

	/** Configuration for various kinds of advanced metadata generation */
	metadata?: {
		/** Enable field order detection. An expensive chcek that decodes the start of the video */
		fieldOrder?: boolean
		/** Number of frames to scan to determine files order. Neede sufficient motion, i.e. beyong title card */
		fieldOrderScanDuration?: number

		/** Enable scene change detection */
		scenes?: boolean
		/** Likelihood frame introduces new scene (`0.0` to `1.0`). Defaults to `0.4` */
		sceneThreshold?: number

		/** Enable freeze frame detection */
		freezeDetection?: boolean
		/** Noise tolerance - difference ratio between `0.0` to `1.0`. Default is `0.001` */
		freezeNoise?: number
		/** Duration of freeze before notification. Default is `2s` */
		freezeDuration?: string

		/** Enable black frame detection */
		blackDetection?: boolean
		/** Duration of black until notified. Default `2.0` */
		blackDuration?: string
		/** Ratio of black pixels per frame before frame is black. Value between `0.0` and `1.0` defaulting to `0.98` */
		blackRatio?: number
		/** Luminance threshold for a single pixel to be considered black. Default is `0.1` */
		blackThreshold?: number

		/** Merge black and freeze frame detection results. Default is `true` */
		mergeBlacksAndFreezes?: boolean
	}

	/** Configuration of _hover-scrub_ preview generation */
	previews?: {
		/** Enable preview generation. Default is `false` */
		enable?: boolean
		/** Width of preview video in pixels. Default is `160` */
		width?: number
		/** Height of preview video in pixels. Set height to `-1` - the default - to preserve aspect */
		height?: number
		/** Bitrate for preview video. Default is `40k` */
		bitrate?: string
		/** Sub-folder of `paths.resources` where thumbnails are stored. Defaults to `.../previews` */
		folder?: string
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
	EXPECTED_ITEMS = 'expected_items',
	UNKNOWN = 'unknown'
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
	QUANTEL_HTTP = 'quantel_http',
	UNKNOWN = 'unknown'
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
		ISABackupUrl?: string
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

export type MonitorSettings = MonitorSettingsNull | MonitorSettingsWatcher | MonitorSettingsQuantel
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
	WATCHER = 'watcher',
	QUANTEL = 'quantel'
}
export interface MonitorSettingsNull extends MonitorSettingsBase {
	type: MonitorSettingsType.NULL
}
export interface MonitorSettingsWatcher extends MonitorSettingsBase {
	type: MonitorSettingsType.WATCHER

	/** See https://www.npmjs.com/package/chokidar#api */
	scanner: WatchOptions
	/** Maximum number of times to try and scan a file. */
	retryLimit: number
}

export interface MonitorSettingsQuantel extends MonitorSettingsBase {
	type: MonitorSettingsType.QUANTEL

	/** Url to the quantel gateway  */
	gatewayUrl: string
	/** Address to the master ISA, for the gateway to connect to */
	ISAUrl: string
	/** Address to the backup ISA, for the gateway to failover to */
	ISABackupUrl?: string
	/** The ID of the zone to use. If omitted, will be using "default" */
	zoneId?: string
	/** The id of the server to control. An Ingeter */
	serverId: number
	/** Base Url for Quantel transformer used for metadata generation */
	transformerUrl?: string
}
