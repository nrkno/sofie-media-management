// import redio from 'redioactive'
import got from 'got'

const file = 'd:/NRK/MINISKI-XX-NO_20200630161932_1_633933.mxf'

const work = `import redio, { end } from 'redioactive'
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
`

async function run() {
    let result = await got.post('http://grace:4200/job?timeout=120000', { 
        headers: {
            'Content-Type': 'text/plain'
        },
        body: work,
        responseType: 'text' })
    console.log(result.body)
}

run()