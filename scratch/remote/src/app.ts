import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as cors from '@koa/cors'
import * as bodyParser from 'koa-bodyparser'
import { NodeVM, CompilerFunction } from 'vm2'
import * as ts from 'typescript'

let tsc: CompilerFunction = (source: string, _filename: string) => {
    return ts.transpile(source)
}

interface Job {
    id: number
    vm: NodeVM
    runner: Promise<void>
    loggerOut: string
    errorOut: string
    status: 'running' | 'completed' | 'failed'
    error?: any,
    timeout: number
}

const app = new Koa()
const router = new Router()
const makeVM = (sandbox: Record<string, unknown>) => new NodeVM({
    console: 'redirect',
    sandbox,
    compiler: tsc,
    require: {
        external: ['redioactive', 'beamcoder'],
        import: ['redioactive', 'beamcoder']
    }
})
const jobs: Map<number, Job> = new Map
let jobCount = 0

app.use(cors({
    'origin': '*'
}))
app.use(bodyParser({
    enableTypes: ['text']
}))

router.get('/', async (ctx, next) => {
    ctx.body = { msg: 'Hello World', params: ctx.params }
    await next()
})

router.post('/job', async (ctx) => {
    let resolver: (v?: void | PromiseLike<void> | undefined) => void = () => {}
    let sandbox = { done: () => { resolver() } }
    let timeout = isNaN(+ctx.query['timeout']) ? 5000 : +ctx.query['timeout']
    let j: Job = {
        id: jobCount++,
        vm: makeVM(sandbox),
        loggerOut: '',
        errorOut: '',
        status: 'running',
        runner: Promise.resolve(),
        timeout
    }
    j.vm.on('console.log', (...s: Array<string>) => {
        j.loggerOut += (j.loggerOut.length > 0 ? '\n' : '') + s.join(' ')
    })
    j.vm.on('console.error', (...s: Array<string>) => {
        j.errorOut += (j.errorOut.length > 0 ? '\n' : '') + s.join(' ')
    })
    j.runner = new Promise((resolve, reject) => {
        resolver = resolve
        try {           
            j.vm.run(ctx.request.body, __filename)
        } catch (err) {
            reject(`Error starting job ${j.id}: ${err}`)
        }
        setTimeout(() => { reject(`Job ${j.id} timed out`) }, j.timeout)
    })
    j.runner.then(() => { 
        j.status = 'completed' 
    }, err => {
        j.status = 'failed'
        j.error = err
    })
    console.log(`Job created: ${j.id}`)
    j.vm.on('console.log', console.log)
    jobs.set(j.id, j)
    ctx.status = 201
    ctx.set('Location', `/job/${j.id}`)
    ctx.body = 'Job started'
})

router.get('/job', async (ctx) => {
    let jobList = []
    for ( let [,job] of jobs ) {
        jobList.push(Object.assign({}, job, { 
            vm: undefined, 
            runner: undefined,
            loggerOut: undefined,
            errorOut: undefined
        }))
    }
    ctx.body = jobList   
})

router.get('/job/:id', async (ctx) => {
    if (!isNaN(+ctx.params['id']) && jobs.has(+ctx.params['id'])) {
        ctx.body = Object.assign(jobs.get(+ctx.params['id']), { 
            vm: undefined, 
            runner: undefined
         })
    }   
})

app.use(router.routes()).use(router.allowedMethods())

app.listen(4200, () => {
    console.log('Koa started')
})
