import redio, { HTTPOptions, RedioEnd, Valve, end, isEnd } from 'redioactive'
import * as beamy from 'beamcoder'
import { Packet, Frame, Decoder, Filterer } from 'beamcoder'

let packetizer: Valve<Record<string, unknown>, Packet> = (t: Record<string, unknown> | RedioEnd) => {
    return isEnd(t) ? end : beamy.packet(t as any)
}

let decodeFrames: () => Valve<Packet, Frame> = () => {
    let decoder: Decoder | null = null
    return async (t: Packet | RedioEnd) => {
        if (decoder === null) {
            decoder = beamy.decoder({ name: 'h264', width: 1920, height: 1080 })
        }
        if (isEnd(t)) { return end }
        const decodedFrames = await decoder.decode(t)
        return decodedFrames.frames[0]
    }
}

let filterFrames: () => Valve<Frame, Frame> = () => {
    let filter: Filterer | null = null
    return async (t: Frame | RedioEnd) => {
        if (isEnd(t)) { return end }
        if (filter === null) {
            filter = await beamy.filterer({
                filterType: 'video',
                inputParams: [{
                    width: t.width,
                    height: t.height,
                    pixelFormat: t.format && t.format || 'yuv422',
                    timeBase: [1, 25],
                    pixelAspect: [1, 1]
                }],
                outputParams: [{
                    pixelFormat: t.format && t.format || 'yuv422'
                }],
                // filterSpec: 'select=\'gt(scene,0.2)\',showinfo'
                filterSpec: 'blackdetect=d=2.0:pic_th=0.98:pix_th=0.1,freezedetect=n=0.001:d=2s,select=\'gte(scene,0.0)\''
                //filterSpec: 'freezedetect=n=0.001:d=2s'
            })
            console.log(filter.graph.dump()) 
        }
        const filteredFrames = await filter.filter([t])
        // console.log(filterFrames[0].name)
        return filteredFrames[0].frames[0]
    }
}

redio<Record<string, unknown>>('/my/video', { 
        blob: 'data', 
        httpPort: 8001,
        manifest: 'streamInfo'
    } as HTTPOptions)
    // .doto(starter())
    .valve<Packet>(packetizer)
    .filter(x => x.stream_index === 0)
    .valve<Frame>(decodeFrames())
    .valve<Frame>(filterFrames())
    .filter(f => +f.metadata['lavfi.scene_score'] > 0.2 || 
        f.metadata['lavfi.black_end'] !== undefined || 
        f.metadata['lavfi.black_start'] !== undefined ||
        f.metadata['lavfi.freezedetect.freeze_start'] !== undefined)
    .each(x => console.dir(x.metadata, { getters: true }))
