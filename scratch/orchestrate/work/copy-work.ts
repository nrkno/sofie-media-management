import redio, { end } from 'redioactive'
import * as beamy from 'beamcoder'

async function run() {
    let demux = await beamy.demuxer('${file}')
    
    console.log(JSON.stringify(demux, null, 2))
    let readFunnel: Funnel<Packet> = async () => {
        let p = await demux.read()
        return p ? p : end
    }
    redio<Packet>(readFunnel)
    .filter(x => x.stream_index < 3)
    .doto(x => console.log(x.size || 0))
    .http('/my/video', { 
        httpPort: 4201, 
        blob: 'data',
        manifest: <Record<string, unknown>> (demux as unknown)
     })
     .done(() => {
         console.log('Finished now')
         done()
     })
}

run()