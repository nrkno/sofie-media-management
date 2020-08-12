// import redio from 'redioactive'
import got from 'got'

const file = 'MINISKI-XX-NO_20200630161932_1_633933.mxf'

const work = `import redio, { HTTPOptions, isEnd, end, Valve, RedioEnd } from 'redioactive'
import * as beamy from 'beamcoder'
import { Packet, Muxer, Stream, Demuxer } from 'beamcoder'

let packetizer: Valve<Record<string, unknown>, Packet> = (t: Record<string, unknown> | RedioEnd) => {
    return isEnd(t) ? end : beamy.packet(t as any)
}

let muxer: Muxer
let vstream: Stream
let lastream: Stream
let rastream: Stream

function starter() {
    let created = false
    return (x: Record<string, unknown>) => {
        if (!created) {
            created = true
            // console.log(x)
            muxer = beamy.muxer({ filename: 'file:${file}' })
            vstream = muxer.newStream((<Demuxer> x.streamInfo).streams[0])
            lastream = muxer.newStream((<Demuxer> x.streamInfo).streams[1])
            rastream = muxer.newStream((<Demuxer> x.streamInfo).streams[2])
            // console.log(vstream, lastream, rastream)
        }
    }
}

let muxWriter: () => Valve<Packet, Packet> = () => {
    let initialized = false
    return async (t: Packet | RedioEnd) => {
        if (isEnd(t)) {
            return end
        }
        if (!initialized) {
            await muxer.openIO()
            await muxer.writeHeader()
            initialized = true
        }
        await muxer.writeFrame(t)
        return t
    } 
}

async function run() {
    redio<Record<string, unknown>>('http://grace:4201/my/video', { 
        blob: 'data', 
        httpPort: 4201,
        manifest: 'streamInfo'
    } as HTTPOptions)
    .doto(starter())
    .valve<Packet>(packetizer)
    .valve<Packet>(muxWriter())
    .each(x => console.log(x.size, x.data && (<Buffer> x.data).length || 0))
    .done(() => {
        console.log('Stream ended.')
        muxer.writeTrailer()
        done()
    })
}

run()
`

async function run() {
    let result = await got.post('http://perlman:4200/job?timeout=120000', { 
        headers: {
            'Content-Type': 'text/plain'
        },
        body: work,
        responseType: 'text' })
    console.log(result.body)
}

run()