const fs = require('fs-extra')

const sandboxExt = [
    'beamcoder',
    'redioactive',
    'bindings',
    'segfault-handler',
    'nan',
    'file-uri-to-path'
]

async function run() {
    await fs.ensureDir('deploy/node_modules')
    for ( let ext of sandboxExt ) {
        await fs.ensureDir(`deploy/node_modules/${ext}`)
        await fs.copy(`node_modules/${ext}`, `deploy/node_modules/${ext}`)
    }
}

run()
