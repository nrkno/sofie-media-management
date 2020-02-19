import * as request from 'request-promise-native'
import { parseStringPromise as parseString } from 'xml2js'
import * as fs from 'fs-extra'

async function run() {
  let clipsXML = await request.get('http://oaqhttp01/quantel/homezone/clips/search?q=*&start=0&rows=20000')
  let clipsJSON = await parseString(clipsXML)
  // console.dir(clipsJSON.feed.entry, { depth: 10 })
  let count = 0
  for ( let entry of clipsJSON.feed.entry ) {
    // console.log(entry.content[0].ClipID[0])
    try {
      // let tedial = entry.content[0].Category[0] !== 'Tedial'
      let image = await request(
        `http://oaqhttp01/quantel/homezone/clips/stills/${entry.content[0].ClipID[0]}/0.256.jpg`,
        { encoding: null }
      )
      await fs.writeFile(`thumbs/${entry.content[0].ClipGUID[0].toUpperCase()}.jpg`, image)
      console.log(`Created thumbnail ${count++}/${clipsJSON.feed.entry.length} for clipID ${entry.content[0].ClipID[0]}: ${entry.content[0].ClipGUID[0].toUpperCase()}.jpg`)
    } catch (err) {
      console.dir(entry, { depth: 10 })
    }
  }
}

run()
