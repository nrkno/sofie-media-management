import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as send from 'koa-send'
import * as cors from '@koa/cors'
import * as range from 'koa-range'
import * as fs from 'fs-extra'
import * as path from 'path'
import { default as got } from 'got'
import { DeviceSettings, MediaObject } from './api'
import { LoggerInstance } from 'winston'
import { noTryAsync } from 'no-try'

// FIXME temporary reference to transformer ... get via Quantel Monitor
const transformer = 'https://xproqhttp01'

export class MediaManagerApp {
	private app = new Koa()
	private router = new Router()

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

		// TODO make it work with non-quantel images

		this.router.get('/media/thumbnail/:id+', async (ctx, next) => {
			this.logger.debug(`HTTP/S server: received thumbnail request "${ctx.params.id}"`)
			if (ctx.params.id.startsWith('QUANTEL:')) {
				let id = ctx.params.id.slice(8)
				ctx.type = 'image/jpeg'
				await send(ctx, `thumbs/${id}.jpg`)
			} else {
				this.logger.debug(`Making database thumbnail request for "${ctx.params.id}"`)
				const { result, error } = await noTryAsync(() =>
					this.mediaDB.get<MediaObject>(ctx.params.id.toUpperCase(), { attachments: true, binary: true })
				)

				if (error) {
					this.logger.warn(`Database requests for "${ctx.params.id}" failed: ${error.message}`)
					ctx.status = 404
					return await next()
				}
				const _attachments = result._attachments
				// this.logger.debug(`Attachments is ${JSON.stringify(_attachments)}`)
				if (!_attachments || (_attachments && !_attachments['thumb.png'])) {
					ctx.status = 404
					return await next()
				}

				ctx.type = 'image/png'
				ctx.body = (_attachments['thumb.png'] as PouchDB.Core.FullAttachment).data
			}
		})

		this.router.get('/media/preview/:id+', async (ctx, next) => {
			this.logger.debug(`HTTP/S server: received preview request ${ctx.params.id}`)
			let id = ctx.params.id.startsWith('QUANTEL:') ? ctx.params.id.slice(8) : ctx.params.id
			ctx.type = 'video/webm'
			let previewPath = path.join(
				(this.config.paths && this.config.paths.resources) || '',
				(this.config.previews && this.config.previews.folder) || '',
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

		this.router.get('/quantel/*', async (ctx) => {
			this.logger.debug(`Pass-through requests to transformer: ${ctx.path}`)
			if (ctx.path.endsWith('init.mp4')) {
				const initReq = await got(`${transformer}${ctx.path}`, { responseType: 'buffer' })
				const initBuf = initReq.body
				const stsc = initBuf.indexOf('stsc')
				initBuf.writeUInt32BE(0, stsc + 8)
				const stco = initBuf.indexOf('stco')
				initBuf.writeUInt32BE(0, stco + 8)
				ctx.type = initReq.headers['content-type'] || 'video/mpeg-4'
				ctx.body = initBuf
				return
			}
			let response = got.stream(`${transformer}${ctx.path}`)
			ctx.body = response
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
}
