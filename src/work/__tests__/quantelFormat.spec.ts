import makeMetadata from '../quantelFormats'
import { ClipData } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

const clipData633_524: ClipData = {
	type: 'ClipData',
	Category: 'Tedial',
	ClipID: 751189,
	CloneId: 751189,
	CloneZone: 614,
	Completed: '2020-05-28T09:24:18.000Z',
	Created: '2020-05-28T09:24:13.000Z',
	Description: '',
	Destination: 0,
	Expiry: '2020-08-26T09:25:20.000Z',
	Frames: '353',
	HasEditData: 0,
	Inpoint: null,
	JobID: null,
	Modified: '2020-05-28T09:25:21.000Z',
	NumAudTracks: 1,
	Number: null,
	NumVidTracks: 1,
	Outpoint: null,
	Owner: 'Tedial',
	PlaceHolder: false,
	PlayAspect: '',
	PoolID: 6140,
	PublishedBy: '',
	Register: '0',
	Tape: '',
	Template: 0,
	Title: 'HEAD-ALUDYNE-270520S-SL',
	UnEdited: 1,
	PlayMode: '',
	MosActive: false,
	Division: '',
	AudioFormats: '524',
	VideoFormats: '633',
	ClipGUID: 'cb0715ee-a286-4f8d-a0e0-628da8108b7f',
	Protection: '',
	VDCPID: '',
	PublishCompleted: '2020-05-28T09:24:18.000Z'
}

describe('Test AVC-I 8-channel audio', () => {
	test('Format converts ok', () => {
		const transformed: any = makeMetadata(clipData633_524)
		// console.log(transformed)
		expect(transformed.streams).toHaveLength(9)
		expect(transformed.format.nb_streams).toBe(9)
		transformed.streams.forEach((s, index: number) => {
			expect(s.codec_type).toEqual(index === 0 ? 'video' : 'audio')
			expect(s.codec_name).toEqual(index === 0 ? 'h264' : 'pcm_s24le')
			expect(s.index).toEqual(index)
			expect(s.duration).toEqual('14.12')
		})
	})
})

const clipData91_521: ClipData = {
	type: 'ClipData',
	Category: 'Omnibus',
	ClipID: 12532,
	CloneId: 12532,
	CloneZone: 614,
	Completed: '2014-10-09T08:25:12.000Z',
	Created: '2014-10-09T08:25:12.000Z',
	Description: 'NYHETER',
	Destination: null,
	Expiry: null,
	Frames: '208',
	HasEditData: 0,
	Inpoint: null,
	JobID: 12532,
	Modified: '2014-10-10T12:40:50.000Z',
	NumAudTracks: 1,
	Number: null,
	NumVidTracks: 1,
	Outpoint: null,
	Owner: '',
	PlaceHolder: false,
	PlayAspect: '',
	PoolID: 6140,
	PublishedBy: '',
	Register: '1',
	Tape: 'HOLD 200101',
	Template: 0,
	Title: 'BUMPER-OA',
	UnEdited: 1,
	PlayMode: '',
	MosActive: false,
	Division: '',
	AudioFormats: '521',
	VideoFormats: '91',
	ClipGUID: '1cec8465e9734b469844a6c3c9c9516e',
	Protection: '',
	VDCPID: '',
	PublishCompleted: null
}

describe('Test IMX-50 4-channel 16-bit audio', () => {
	test('Format converts ok', () => {
		const transformed: any = makeMetadata(clipData91_521)
		// console.log(transformed)
		expect(transformed.streams).toHaveLength(5)
		expect(transformed.format.nb_streams).toBe(5)
		transformed.streams.forEach((s: any, index: number) => {
			expect(s.codec_type).toEqual(index === 0 ? 'video' : 'audio')
			expect(s.codec_name).toEqual(index === 0 ? 'mpeg2video' : 'pcm_s16le')
			expect(s.index).toEqual(index)
			expect(s.duration).toEqual('8.32')
		})
	})
})
