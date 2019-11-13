const find = require('find');
const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const arch = os.arch()
const platform = os.platform()

function isFileForPlatform(filename) {
    if (filename.indexOf(path.join('prebuilds', `${platform}-${arch}`)) !== -1) {
        return true
    } else {
        return false
    }
}

console.log('Running in', __dirname)

find.file(/\.node$/, path.join(__dirname, 'node_modules'), (files) => {
    files.forEach(fullPath => {
        if (fullPath.indexOf(__dirname) === 0) {
            const file = fullPath.substr(__dirname.length + 1)
            if (isFileForPlatform(file)) {
                console.log('copy prebuild binary:', file)
                fs.copySync(file, path.join('deploy', file))
            }
        }
    });
})
