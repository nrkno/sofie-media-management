import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as send from 'koa-send'
import * as cors from '@koa/cors'
import * as range from 'koa-range'
import * as fs from 'fs-extra'
import * as path from 'path'
import { DeviceSettings } from './api'
import { LoggerInstance } from 'winston'
import { noTryAsync } from 'no-try'

export class MediaManagerApp {
	private app = new Koa()
	private router = new Router()

	constructor(
		private config: DeviceSettings,
		private logger: LoggerInstance
	) {
		this.app.use(range)

		this.app.use(cors({
		  'origin': '*'
		}))
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
				this.config.paths && this.config.paths.resources || '',
				this.config.previews && this.config.previews.folder || 'thumbs',
				`${id}.jpg`
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

		this.router.get('/media/preview/:id', async (ctx, next) => {
		  this.logger.debug(`HTTP/S server: received preview request ${ctx.params.id}`)
			let id = ctx.params.id.startsWith('QUANTEL:') ? ctx.params.id.slice(8) : ctx.params.id
			ctx.type = 'video/webm'
			let previewPath = path.join(
				this.config.paths && this.config.paths.resources || '',
				this.config.previews && this.config.previews.folder || 'previews',
				`${id}.webm`
			)
			let { result: stats, error: statError } = await noTryAsync(() => fs.stat(previewPath))
			if (statError) {
				this.logger.warning(`HTTP/S server: preview requested that did not exist ${ctx.params.id}`, statError)
				return await next()
			}
			ctx.body = fs.createReadStream(previewPath)
			ctx.length = stats.size
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		return new Promise((resolve) => {
			if (this.config.httpPort) {
				this.app.listen(this.config.httpPort, () => {
					this.logger.info(`MediaMangerApp: Koa started on HTTP port ${this.config.httpPort}`)
					resolve()
				})
			}
		})
		// Not doing HTTPS ... use nginx or equivalent to front this
	}
}
