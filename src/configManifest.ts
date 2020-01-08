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
		name: 'TargetStorage',
		type: ConfigManifestEntryType.STRING // dropdown
	}
]
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.LOCAL_INGEST] = [...MEDIA_MANAGER_MEDIAFLOW_COMMON]
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaFlowType.EXPECTED_ITEMS] = [
	...MEDIA_MANAGER_MEDIAFLOW_COMMON,
	{
		id: 'targetId',
		name: 'TargetStorage',
		type: ConfigManifestEntryType.STRING // dropdown
	}
]

export enum MediaMonitorType {
	NULL = 'null',
	MEDIA_SCANNER = 'mediascanner',
	QUANTEL = 'quantel'
}
const MEDIA_MANAGER_MEDIAMONITOR_COMMON: SubDeviceConfigManifestEntry[] = [
	{
		id: 'id',
		name: 'Monitor ID',
		columnName: 'Monitor ID',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'storageId',
		name: 'Storage ID',
		type: ConfigManifestEntryType.STRING // is actually a dropdown of storages
	}
]
const MEDIA_MANAGER_MEDIAMONITOR_CONFIG: SubDeviceConfigManifest['config'] = {}
MEDIA_MANAGER_MEDIAFLOW_CONFIG[MediaMonitorType.NULL] = []
MEDIA_MANAGER_MEDIAMONITOR_CONFIG[MediaMonitorType.MEDIA_SCANNER] = [
	...MEDIA_MANAGER_MEDIAMONITOR_COMMON,
	{
		id: 'host',
		name: 'Host',
		type: ConfigManifestEntryType.STRING
	},
	{
		id: 'port',
		name: 'Port',
		type: ConfigManifestEntryType.STRING
	}
]
MEDIA_MANAGER_MEDIAMONITOR_CONFIG[MediaFlowType.WATCH_FOLDER] = [
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
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'lingerTime',
			name: 'File Linger Time',
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'workFlowLingerTime',
			name: 'Workflow Linger Time',
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'cronJobTime',
			name: 'Cron-Job Interval Time',
			type: ConfigManifestEntryType.INT
		},
		{
			id: 'mediaScanner.host',
			name: 'Media Scanner Host',
			type: ConfigManifestEntryType.STRING
		},
		{
			id: 'mediaScanner.port',
			name: 'Media Scanner Port',
			type: ConfigManifestEntryType.INT
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
