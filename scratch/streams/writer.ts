import redio, { HTTPOptions, RedioEnd, Valve, end, isEnd } from 'redioactive'
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
            console.log(x)
            muxer = beamy.muxer({ filename: 'file:C:/Users/spark/Documents/sofie/CasparCG.Server-2.1.11NRK/CasparCG Server/server/media/muxedout.mxf' })
            vstream = muxer.newStream((<Demuxer> x.streamInfo).streams[0])
            lastream = muxer.newStream((<Demuxer> x.streamInfo).streams[1])
            rastream = muxer.newStream((<Demuxer> x.streamInfo).streams[2])
            console.log(vstream, lastream, rastream)
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

redio<Record<string, unknown>>('http://localhost:8001/my/video', { 
        blob: 'data', 
        httpPort: 8001,
        manifest: 'streamInfo'
    } as HTTPOptions)
    .doto(starter())
    .valve<Packet>(packetizer)
    .valve<Packet>(muxWriter())
    .each(x => console.log(x.size, (<Buffer> x.data).length))
    .done(() => {
        muxer.writeTrailer()
    })