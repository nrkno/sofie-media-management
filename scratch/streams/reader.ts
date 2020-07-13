import * as beamy from 'beamcoder'
import redio, { Funnel, end } from 'redioactive'
import { Packet } from 'beamcoder'

const file = 'c:/Users/spark/Documents/media/NRK/MINISKI-XX-NO_20200630161932_1_633933.mxf'

async function run() {
    let demux = await beamy.demuxer(file)
    console.log(JSON.stringify(demux, null, 2))
    let readFunnel: Funnel<Packet> = async () => {
        let p = await demux.read()
        return p ? p : end
    }
    redio<Packet>(readFunnel)
    .filter(x => x.stream_index < 3)
    .doto(x => console.log(x.size))
    .http('/my/video', { 
        httpPort: 8001, 
        blob: 'data',
        manifest: <Record<string, unknown>> (demux as unknown)
     })
}

run()