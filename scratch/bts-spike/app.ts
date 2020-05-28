import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as send from 'koa-send'
import * as cors from '@koa/cors'
import * as range from 'koa-range'
import * as fs from 'fs-extra'

let app = new Koa()
let router = new Router()

app.use(range)

app.use(cors({
  'origin': '*'
}))

router.get('/', async (ctx, next) => {
  ctx.body = { msg: 'Hello World', params: ctx.params }
  await next()
})

router.get('/media/thumbnail/:id', async (ctx, next) => {
  console.log(`Received thumbnail request ${ctx.params.id}`)
  if (ctx.params.id.startsWith('QUANTEL:')) {
    let id = ctx.params.id.slice(8)
    // let image = await fs.readFile(`thumbs/${id}.jpg`)
    ctx.type = 'image/jpeg'
    await send(ctx, `thumbs/${id}.jpg`)
  } else {
    await next()
  }
})

router.get('/media/preview/:id', async (ctx, next) => {
  console.log(`Received preview request ${ctx.params.id}`)
  if (ctx.params.id.startsWith('QUANTEL:')) {
    let id = ctx.params.id.slice(8)
    // let video = await fs.readFile(`previews/${id}.webm`)
    ctx.type = 'video/webm'
    let length = await fs.stat(`previews/${id}.webm`)
    ctx.body = fs.createReadStream(`previews/${id}.webm`)
    ctx.length = length.size
    console.log(`Finished sending ${id}`)
  } else {
    await next()
  }
})

router.all('/:all*', async (ctx, next) => {
  console.log('Dropped through.', ctx.params.all)
  await ctx.redirect(`http://160.68.21.32:8000/${ctx.params.all}`)
  await next()
})

app.use(router.routes()).use(router.allowedMethods())

app.listen(3000, () => {
  console.log('Koa started')
})
