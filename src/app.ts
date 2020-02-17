import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as send from 'koa-send'
import * as cors from '@koa/cors'
import * as range from 'koa-range'
import * as fs from 'fs-extra'
import { DeviceSettings } from './api'
import { LoggerInstance } from 'winston'

export class MediaManagerApp {
	private app = new Koa()
	private router = new Router()

	constructor(private config: DeviceSettings, private logger: LoggerInstance) {
		this.app.use(range)

		this.app.use(cors({
		  'origin': '*'
		}))

		this.router.get('/', async (ctx, next) => {
		  ctx.body = { msg: 'Hello World', params: ctx.params }
		  await next()
		})

		// TODO make it work with non-quantel images

		this.router.get('/media/thumbnail/:id', async (ctx, next) => {
		  console.log(`Received thumbnail request ${ctx.params.id}`)
		  if (ctx.params.id.startsWith('QUANTEL:')) {
				let id = ctx.params.id.slice(8)
				ctx.type = 'image/jpeg'
				await send(ctx, `thumbs/${id}.jpg`)
		  } else {
				await next()
		  }
		})

		this.router.get('/media/preview/:id', async (ctx, next) => {
		  console.log(`Received preview request ${ctx.params.id}`)
		  if (ctx.params.id.startsWith('QUANTEL:')) {
				let id = ctx.params.id.slice(8)
				ctx.type = 'video/webm'
				let length = await fs.stat(`previews/${id}.webm`)
				ctx.body = fs.createReadStream(`previews/${id}.webm`)
				ctx.length = length.size
				console.log(`Finished sending ${id}`)
		  } else {
				await next()
		  }
		})

		// TODO other medio

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		if (this.config.httpPort) {
			this.app.listen(this.config.httpPort, () => {
				this.logger.info(`MediaMangerApp: Koa started on HTTP port ${this.config.httpPort}`)
			})
		}
		// TODO HTTPS
	}
}
