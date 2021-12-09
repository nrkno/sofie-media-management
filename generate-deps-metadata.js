const fs = require('fs')

let versions = {}

if (process.env.npm_package_version) {
	versions['_process'] = process.env.npm_package_version
}

let dirNames = [
	// TODO: add any relevant sub-libraries here, to report to Core
	// '@sofie-automation/server-core-integration',
	// 'timeline-state-resolver',
]
try {
	let nodeModulesDirectories = fs.readdirSync('node_modules')
	nodeModulesDirectories.forEach(dir => {
		try {
			if (dirNames.indexOf(dir) !== -1) {
				let file = 'node_modules/' + dir + '/package.json'
				file = fs.readFileSync(file, 'utf8')
				let json = JSON.parse(file)
				versions[dir] = json.version || 'N/A'
			}
		} catch (e) {
			console.error(e)
			process.exit(1)
		}
	})
} catch (e) {
	console.error(e)
	process.exit(2)
}

fs.writeFileSync('dist/deps-metadata.json', JSON.stringify(versions))
