import * as request from 'request-promise-native'
import { parseStringPromise as parseString } from 'xml2js'
import { exec } from 'child_process'

async function run() {
  let clipsXML = await request.get('http://oaqhttp01/quantel/homezone/clips/search?q=bts*&start=0&rows=20000')
  let clipsJSON = await parseString(clipsXML)
  console.dir(clipsJSON.feed.entry.map((x: any) => x.content[0].Title[0]))
  let count = 0
  for ( let entry of clipsJSON.feed.entry ) {
    // console.log(entry.content[0].ClipID[0])
    try {
      // let tedial = entry.content[0].Category[0] !== 'Tedial'
      const args = [
        'ffmpeg.exe',
        '-seekable 0',
        '-i', `http://oaqhttp01/quantel/homezone/clips/streams/${entry.content[0].ClipID[0]}/stream.m3u8`,
        '-map p:2',
        '-f webm',
        '-an',
        '-c:v libvpx',
        '-b:v 40k',
        '-auto-alt-ref 0',
        '-vf scale=160:-1',
        '-threads 4',
        '-deadline good',
        `previews/${entry.content[0].ClipGUID[0].toUpperCase()}.webm`
      ]
      await new Promise((resolve, reject) => {
        exec(args.join(' '), (err, stdout, stderr) => {
          if (err) { reject(err) }
          else { resolve({ stdout, stderr }) }
        })
      })
      console.log(`Created preview ${count++}/${clipsJSON.feed.entry.length} for clipID ${entry.content[0].ClipID[0]}: ${entry.content[0].ClipGUID[0].toUpperCase()}.webm`)
    } catch (err) {
      console.error(err)
      console.dir(entry, { depth: 10 })
    }
  }
}

run()
