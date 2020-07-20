import redio, { HTTPOptions, RedioEnd, Valve, end, isEnd, LotsOfLiquid } from 'redioactive'
import * as beamy from 'beamcoder'
import { Packet, Frame, Decoder, Encoder } from 'beamcoder'

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

let encodeFrames: () => Valve<Frame, Packet> = () => {
    let encoder: Encoder | null = null
    let flushed = false
    return async (t: Frame | RedioEnd): Promise<LotsOfLiquid<Packet>> => {
        if (encoder === null) {
            encoder = beamy.encoder({ 
                name: 'libvpx', 
                time_base: [1, 25],
                pix_fmt: 'yuv420p',
                width: 160,
                height: 90,
                bit_rate: 40000,
                priv_data: {
                    'auto-alt-ref': 0
                }
            })
        }
        if (isEnd(t)) {
            if (!flushed) {
                let result = await encoder.flush()
                flushed = true
                let packets: Array<Packet | RedioEnd> = result.packets
                packets.push(end)
                return packets
            }
            return end
        }
        let result = await encoder.encode(t)
        return result.packets
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
.valve<Packet>(encodeFrames(), { oneToMany: true })
.each(x => console.dir(x, { getters: true }))
