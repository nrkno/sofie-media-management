import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as send from 'koa-send'
import * as cors from '@koa/cors'
import * as range from 'koa-range'
import * as fs from 'fs-extra'
import * as path from 'path'
import { default as got } from 'got'
import { DeviceSettings, MediaObject, QuantelStreamType } from './api'
import { LoggerInstance } from 'winston'
import { noTryAsync } from 'no-try'
import { MonitorQuantel } from './monitors/quantel'
import { parseStringPromise as xmlParser } from 'xml2js'

export class MediaManagerApp {
	private app = new Koa()
	private router = new Router()
	private transformer: string | undefined = undefined
	private smoothStream: boolean = false

	constructor(
		private config: DeviceSettings,
		private mediaDB: PouchDB.Database<MediaObject>,
		private logger: LoggerInstance
	) {
		this.app.use(range)

		this.app.use(
			cors({
				origin: '*'
			})
		)
	}

	async init() {
		this.router.get('/', async (ctx, next) => {
			ctx.body = { msg: 'Hello World', params: ctx.params }
			await next()
		})

		this.router.get('/media/thumbnail/:id', async (ctx, next) => {
			this.logger.debug(`HTTP/S server: received thumbnail request ${ctx.params.id}`)
			let id = ctx.params.id.startsWith('QUANTEL:') ? ctx.params.id.slice(8) : ctx.params.id
			let thumbPath = path.join(
				(this.config.paths && this.config.paths.resources) || '',
				(this.config.previews && this.config.previews.folder) || 'thumbs',
				`${id.replace(':', '_')}.jpg`
			)
			let { result: stats, error: statError } = await noTryAsync(() => fs.stat(thumbPath))
			if (statError) {
				this.logger.warning(`HTTP/S server: thumbnail requested that did not exist ${ctx.params.id}`, statError)
				return await next()
			}
			ctx.type = 'image/jpeg'
			ctx.body = await send(ctx, thumbPath)
			ctx.length = stats.size
		})

		this.router.get('/media/preview/:id+', async (ctx, next) => {
			this.logger.debug(`HTTP/S server: received preview request ${ctx.params.id}`)
			let id = ctx.params.id.startsWith('QUANTEL:') ? ctx.params.id.slice(8) : ctx.params.id
			ctx.type = 'video/webm'
			let previewPath = path.join(
				(this.config.paths && this.config.paths.resources) || '',
				(this.config.previews && this.config.previews.folder) || 'previews',
				`${id}.webm`
			)
			let { result: stats, error: statError } = await noTryAsync(() => fs.stat(previewPath))
			if (statError) {
				this.logger.warn(`HTTP/S server: preview requested that did not exist ${ctx.params.id}`, statError)
				return await next()
			}
			ctx.body = fs.createReadStream(previewPath)
			ctx.length = stats.size
		})

		this.router.get('/stat/seq', async (ctx, next) => {
			const { update_seq } = await this.mediaDB.info()

			ctx.body = { update_seq }
			await next()
		})

		this.router.get('/(quantel|gv)/*', async ctx => {
			this.logger.debug(`Pass-through requests to transformer: ${ctx.path}`)
			if (this.transformer === undefined) {
				ctx.status = 502
				ctx.body = 'Transformer URL not set. Cannot talk to HTTP transformer.'
				this.logger.warn('Transformer URL not set. Cannot talk to HTTP transformer.')
				return
			}
			if (ctx.path.endsWith('init.mp4')) {
				const initReq = await got(`${this.transformer}${ctx.path}`, { responseType: 'buffer' })
				const initBuf = initReq.body
				const stsc = initBuf.indexOf('stsc')
				initBuf.writeUInt32BE(0, stsc + 8)
				const stco = initBuf.indexOf('stco')
				initBuf.writeUInt32BE(0, stco + 8)
				ctx.type = initReq.headers['content-type'] || 'video/mpeg-4'
				ctx.body = initBuf
				return
			}
			if (this.smoothStream && ctx.path.endsWith('stream.mpd')) {
				const smoothFestRes = await got(`${this.transformer}${ctx.path.slice(0, -4)}.xml`)
				ctx.type = 'application/xml'
				ctx.body = await manifestTransform(smoothFestRes.body)
				return
			} else {
				const response = got.stream(`${this.transformer}${ctx.path}`)
				ctx.body = response
			}
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		return new Promise(resolve => {
			if (this.config.httpPort) {
				this.app.listen(this.config.httpPort, () => {
					this.logger.info(`MediaMangerApp: Koa started on HTTP port ${this.config.httpPort}`)
					resolve()
				})
			}
		})
		// HTTPS setup through nginx
	}

	get port(): number {
		return this.config.httpPort || 8000
	}

	setQuantelMonitor(monitor: MonitorQuantel) {
		this.transformer = monitor.settings.transformerUrl
		this.smoothStream = monitor.settings.streamType === QuantelStreamType.SMOOTH_STREAM
		if (this.transformer !== undefined) {
			while (this.transformer.endsWith('/')) {
				this.transformer = this.transformer.slice(0, -1)
			}
		}
	}
}

async function manifestTransform(ssxml: string): Promise<string> {
	const ssjs = await xmlParser(ssxml)
	// console.dir(ssjs.SmoothStreamingMedia.StreamIndex, { depth: 10 })
	const ssm = ssjs.SmoothStreamingMedia
	const duration = (+ssm.$.Duration / +ssm.$.TimeScale).toFixed(3)
	const video = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'video')
	const header =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:scte35="http://www.scte.org/schemas/35/2014SCTE35.xsd" xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" minBufferTime="PT5.000S" maxSegmentDuration="PT3.000S" availabilityStartTime="2016-01-20T21:10:02Z" mediaPresentationDuration="PT${duration}S">\n` +
		`  <Period id="period0" duration="PT${duration}S">\n`
	let vAdapt = `    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" maxWidth="${video.$.DisplayWidth}" maxHeight="${video.$.DisplayHeight}" maxFrameRate="${video.$.Fps}" par="1:1">\n`
	for (let ql of video.QualityLevel) {
		vAdapt += `      <Representation id="${ql.$.Bitrate}" bandwidth="${ql.$.Bitrate}" codecs="avc1.4D401E" width="${ql.$.MaxWidth}" height="${ql.$.MaxHeight}" frameRate="${video.$.Fps}" sar="1:1" scanType="progressive">\n`
		vAdapt += `        <BaseURL>stream-mp4/video/</BaseURL>\n`
		vAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		vAdapt += `          <SegmentTimeline>\n`
		for (let seg of video.c) {
			vAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		vAdapt += `          </SegmentTimeline>\n`
		vAdapt += `        </SegmentTemplate>\n`
		vAdapt += `      </Representation>\n`
	}
	vAdapt += `    </AdaptationSet>\n`
	const audio = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'audio')
	let aAdapt = ''
	if (audio) {
		const ql = audio.QualityLevel[0].$
		aAdapt += `    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" lang="qaa">\n`
		aAdapt += `      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000">\n`
		aAdapt += `        <BaseURL>${audio.$.Url.slice(0, audio.$.Url.indexOf('{'))}</BaseURL>\n`
		aAdapt += `        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${ql.Channels}"/>\n`
		aAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="init.mp4" media="$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		aAdapt += `          <SegmentTimeline>\n`
		for (let seg of audio.c) {
			aAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		aAdapt += `          </SegmentTimeline>\n`
		aAdapt += `        </SegmentTemplate>\n`
		aAdapt += `      </Representation>\n`
		aAdapt += `    </AdaptationSet>\n`
	}
	const footer = `  </Period>\n` + `</MPD>\n`
	return header + vAdapt + aAdapt + footer
}
