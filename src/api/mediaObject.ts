export enum MediaStreamType {
	Audio = 'audio',
	Video = 'video',
}

export interface MediaStreamCodec {
	type?: MediaStreamType
	long_name?: string
	time_base?: string
	tag_string?: string
	is_avc?: string
}

export interface MediaStream {
	codec: MediaStreamCodec

	// video
	width?: number
	height?: number
	sample_aspect_ratio?: string
	display_aspect_ratio?: string
	pix_fmt?: string
	bits_per_raw_sample?: string

	// audio
	sample_fmt?: string
	sample_rate?: string
	channels?: number
	channel_layout?: string
	bits_per_sample?: number

	// common
	time_base?: string
	start_time?: string
	duration_ts?: number
	duration?: string

	bit_rate?: string
	max_bit_rate?: string
	nb_frames?: string
}

export interface MediaFormat {
	name?: string
	long_name?: string
	start_time?: string
	duration?: number
	bit_rate?: number
	max_bit_rate?: number
}

export enum FieldOrder {
	Unknown = 'unknown',
	Progressive = 'progressive',
	TFF = 'tff',
	BFF = 'bff',
}

export interface Metadata {
	scenes?: Array<number>
	blacks?: Array<Anomaly>
	freezes?: Array<Anomaly>
}

export interface MediaInfo extends Metadata {
	name: string
	field_order?: FieldOrder
	streams?: MediaStream[]
	format?: MediaFormat
	timebase?: number
}

export interface Anomaly {
	start: number
	duration: number
	end: number
}

export interface MediaAttachment extends PouchDB.Core.FullAttachment {
	// digest: string - from parent
	// content_type: string - fromt parent
	revpos: number
	data: string // base64
}

export interface MediaObject extends PouchDB.Core.IdMeta, PouchDB.Core.GetMeta {
	/** The playable reference (CasparCG clip name, quantel GUID, etc) */
	mediaId: string

	/** Media object file path relative to playout server */
	mediaPath: string
	/** Media object size in bytes */
	mediaSize: number
	/** Timestamp when the media object was last updated */
	mediaTime: number
	/** Info about media content. If undefined: inficates that the media is NOT playable (could be transferring, or a placeholder)  */
	mediainfo?: MediaInfo

	/** Thumbnail file size in bytes */
	thumbSize: number
	/** Thumbnail last updated timestamp */
	thumbTime: number
	/** Thumbnail path */
	thumbPath?: string

	/** Preview file size in bytes */
	previewSize?: number
	/** Thumbnail last updated timestamp */
	previewTime?: number
	/** Preview location. Has to be truthy for hoverscrub and thumbnails to work. */
	previewPath?: string

	cinf: string // useless to us
	tinf: string // useless to us

	// _attachments, _id and _rev come from PouchDB types
}

export interface DiskInfo {
	fs: string
	type?: string
	size: number | null
	used: number | null
	use: number | null
	mount: boolean | string
}
