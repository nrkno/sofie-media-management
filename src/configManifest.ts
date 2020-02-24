/**
 * This file contains the manifest to be used by server-core for displaying the
 * config UI.
 */
import {
	SubDeviceConfigManifest,
	SubDeviceConfigManifestEntry,
	ConfigManifestEntryType,
	DeviceConfigManifest,
	TableConfigManifestEntry
} from 'tv-automation-server-core-integration'

export function literal<T>(o: T) {
	return o
}

export enum StorageType {
	LOCAL_FOLDER = 'local_folder',
	FILE_SHARE = 'file_share',
	UNKNOWN = 'unknown'
	// FTP = 'ftp',
	// AWS_S3 = 'aws_s3'
}
const MEDIA_MANAGER_STORAGE_COMMON: SubDeviceConfigManifestEntry[] = [
	{
		id: 'id',
		name: 'Storage ID',
		columnName: 'Storage ID',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'support.read',
		name: 'Allow Read',
		type: ConfigManifestEntryType.BOOLEAN
	},
	{
		id: 'support.write',
		name: 'Allow Write',
		type: ConfigManifestEntryType.BOOLEAN
	}
]
const MEDIA_MANAGER_STORAGE_CONFIG: SubDeviceConfigManifest['config'] = {}
MEDIA_MANAGER_STORAGE_CONFIG[StorageType.UNKNOWN] = [...MEDIA_MANAGER_STORAGE_COMMON]
MEDIA_MANAGER_STORAGE_CONFIG[StorageType.FILE_SHARE] = [
	...MEDIA_MANAGER_STORAGE_COMMON,
	{
		id: 'options.basePath',
		name: 'Base Path',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.mediaPath',
		name: 'Media Path',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.mappedNetworkedDriveTarget',
		name: 'Mapped Network Drive',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.username',
		name: 'Username',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.password',
		name: 'Password',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.onlySelectedFiles',
		name: "Don't Scan Entire Storage",
		type: ConfigManifestEntryType.BOOLEAN
	}
]
MEDIA_MANAGER_STORAGE_CONFIG[StorageType.LOCAL_FOLDER] = [
	...MEDIA_MANAGER_STORAGE_COMMON,
	{
		id: 'options.basePath',
		name: 'Base Path',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'options.mediaPath',
		name: 'Media Path',
		type: ConfigManifestEntryType.STRING
	}
]

export enum MediaFlowType {
	WATCH_FOLDER = 'watch_folder',
	LOCAL_INGEST = 'local_ingest',
	EXPECTED_ITEMS = 'expected_items',
	UNKNOWN = 'unknown'
}
const MEDIA_MANAGER_MEDIAFLOW_COMMON: SubDeviceConfigManifestEntry[] = [
	{
		id: 'id',
		name: 'Flow ID',
		columnName: 'Flow ID',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'sourceId',
		name: 'Source Storage',
		type: ConfigManifestEntryType.STRING // is actually a dropdown of storages
	}
]
const MEDIA_MANAGER_MEDIAFLOW_CONFIG: SubDeviceConfigManifest['config'] = {}
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.UNKNOWN] = [...MEDIA_MANAGER_MEDIAFLOW_COMMON]
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.WATCH_FOLDER] = [
	...MEDIA_MANAGER_MEDIAFLOW_COMMON,
	{
		id: 'targetId',
		name: 'Target Storage',
		type: ConfigManifestEntryType.STRING // dropdown
	}
]
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.LOCAL_INGEST] = [...MEDIA_MANAGER_MEDIAFLOW_COMMON]
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.EXPECTED_ITEMS] = [
	...MEDIA_MANAGER_MEDIAFLOW_COMMON,
	{
		id: 'targetId',
		name: 'Target Storage',
		type: ConfigManifestEntryType.STRING // dropdown
	}
]

export enum MediaMonitorType {
	NULL = 'null',
	WATCHER = 'watcher',
	QUANTEL = 'quantel'
}
const MEDIA_MANAGER_MEDIAMONITOR_COMMON: SubDeviceConfigManifestEntry[] = [
	{
		id: 'storageId',
		name: 'Storage ID',
		type: ConfigManifestEntryType.STRING // is actually a dropdown of storages
	}
]
const MEDIA_MANAGER_MEDIAMONITOR_CONFIG: SubDeviceConfigManifest['config'] = {}
MEDIA_MANAGER_MEDIAMONITOR_CONFIG[MediaMonitorType.NULL] = []
MEDIA_MANAGER_MEDIAMONITOR_CONFIG[MediaMonitorType.WATCHER] = [
	...MEDIA_MANAGER_MEDIAMONITOR_COMMON,
	{
		id: 'paths',
		name: 'Paths to watch',
		type: ConfigManifestEntryType.STRING
	},
	// TODO work out which watch options to follow
	{
		id: 'casparMediaPath',
		name: 'Path to CasparCG (shared) media folder',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'retryLimit',
		name: 'Maximum number file scane retries',
		type: ConfigManifestEntryType.INT,
		placeholder: '3'
	}
]
MEDIA_MANAGER_MEDIAMONITOR_CONFIG[MediaMonitorType.QUANTEL] = [
	...MEDIA_MANAGER_MEDIAMONITOR_COMMON,
	{
		id: 'gatewayUrl',
		name: 'Gateway URL',
		type: ConfigManifestEntryType.STRING // dropdown
	},
	{
		id: 'ISAUrl',
		name: 'ISA URL',
		type: ConfigManifestEntryType.STRING // dropdown
	},
	{
		id: 'zoneId',
		name: 'Zone ID (leave blank for default)',
		type: ConfigManifestEntryType.STRING // dropdown
	},
	{
		id: 'serverId',
		name: 'Quantel Server ID',
		type: ConfigManifestEntryType.STRING // dropdown
	}
]

export const MEDIA_MANAGER_CONFIG_MANIFEST: DeviceConfigManifest = {
	deviceConfig: [
		{
			id: 'workers',
			name: 'No. of Available Workers',
			type: ConfigManifestEntryType.INT,
			placeholder: '3'
		},
		{
			id: 'lingerTime',
			name: 'File Linger Time (ms)',
			type: ConfigManifestEntryType.INT,
			placeholder: '259200000'
		},
		{
			id: 'workFlowLingerTime',
			name: 'Workflow Linger Time (ms)',
			type: ConfigManifestEntryType.INT,
			placeholder: '86400000'
		},
		{
			id: 'cronJobTime',
			name: 'Cron-Job Interval Time (ms)',
			type: ConfigManifestEntryType.INT,
			placeholder: '3600000'
		},
		{
			id: 'httpPort',
			name: 'HTTP port serving resources',
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'httpsPort',
			name: 'HTTPS port serving resources',
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'thumbnails.width',
			name: 'Thumbnail width',
			type: ConfigManifestEntryType.INT,
			placeholder: '256'
		},
		{
			id: 'thumbnails.height',
			name: 'Thumbnail height, -1 preserves aspect',
			type: ConfigManifestEntryType.INT,
			placeholder: '-1'
		},
		{
			id: 'thumbnails.folder',
			name: 'Thumbnail sub-folder',
			type: ConfigManifestEntryType.STRING,
			placeholder: 'thumbnails'
		},
		{
			id: 'metadata.fieldOrder',
			name: 'Enable field order check',
			type: ConfigManifestEntryType.BOOLEAN
		},
		{
			id: 'metadata.fieldOrderScanDuration',
			name: 'Number of frames to use to test field order',
			type: ConfigManifestEntryType.INT,
			placeholder: '200'
		},
		{
			id: 'metadata.scenes',
			name: 'Enable scene change detection',
			type: ConfigManifestEntryType.BOOLEAN
		},
		{
			id: 'metadata.sceneThreshold',
			name: 'Likelihood frame introduces new scene (0.0 to 1.0)',
			type: ConfigManifestEntryType.NUMBER,
			placeholder: '0.4'
		},
		{
			id: 'metadata.freezeDetection',
			name: 'Enable freeze frame detection',
			type: ConfigManifestEntryType.BOOLEAN
		},
		{
			id: 'metadata.freezeNoise',
			name: 'Noise tolerance - difference ratio 0.0 upto 1.0',
			type: ConfigManifestEntryType.NUMBER,
			placeholder: '0.001'
		},
		{
			id: 'metadata.freezeDuration',
			name: 'Duration of freeze until notified, e.g. "2s"',
			type: ConfigManifestEntryType.STRING,
			placeholder: '2s'
		},
		{
			id: 'metadata.blackDetection',
			name: 'Enable black frame detection',
			type: ConfigManifestEntryType.STRING
		},
		{
			id: 'metadata.blackDuration',
			name: 'Duration of black until notified, e.g. "2s"',
			type: ConfigManifestEntryType.STRING,
			placeholder: '2s'
		},
		{
			id: 'metadata.blackRatio',
			name: 'Ratio of black pixels',
			type: ConfigManifestEntryType.NUMBER,
			placeholder: '0.98'
		},
		{
			id: 'metadata.blackThreshold',
			name: 'Luminance threshold - pixel is black',
			type: ConfigManifestEntryType.NUMBER,
			placeholder: '0.1'
		},
		{
			id: 'metadata.mergeBlacksAndFreezes',
			name: 'Merge black with freeze frame',
			type: ConfigManifestEntryType.BOOLEAN
		},
		{
			id: 'previews.enable',
			name: 'Enable preview generation',
			type: ConfigManifestEntryType.BOOLEAN
		},
		{
			id: 'previews.width',
			name: 'Preview width',
			type: ConfigManifestEntryType.INT,
			placeholder: '160'
		},
		{
			id: 'previews.height',
			name: 'Preview height, -1 preserves aspect',
			type: ConfigManifestEntryType.INT,
			placeholder: '-1'
		},
		{
			id: 'previews.bitrate',
			name: 'Preview bitrate, e.g. 40k',
			type: ConfigManifestEntryType.STRING,
			placeholder: '40k'
		},
		{
			id: 'previews.folder',
			name: 'Preview sub-folder',
			type: ConfigManifestEntryType.STRING,
			placeholder: 'previews'
		},
		{
			id: 'debugLogging',
			name: 'Activate Debug Logging',
			type: ConfigManifestEntryType.BOOLEAN
		},
		literal<TableConfigManifestEntry>({
			id: 'storages',
			name: 'Attached Storages',
			type: ConfigManifestEntryType.TABLE,
			defaultType: StorageType.UNKNOWN,
			config: MEDIA_MANAGER_STORAGE_CONFIG
		}),
		literal<TableConfigManifestEntry>({
			id: 'mediaFlows',
			name: 'Media Flows',
			type: ConfigManifestEntryType.TABLE,
			defaultType: MediaFlowType.UNKNOWN,
			typeField: 'mediaFlowType',
			config: MEDIA_MANAGER_MEDIAFLOW_CONFIG
		}),
		literal<TableConfigManifestEntry>({
			id: 'monitors',
			name: 'Monitors',
			type: ConfigManifestEntryType.TABLE,
			defaultType: MediaMonitorType.NULL,
			isSubDevices: true,
			config: MEDIA_MANAGER_MEDIAMONITOR_CONFIG
		})
	]
}
