import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export namespace robocopy {
	export function copyFile(src: string, dst: string, progress?: (progress: number) => void): Promise<void> {
		if (process.platform !== 'win32') {
			throw new Error('Only Win32 environment is supported for RoboCopy')
		}
		return new Promise<void>((resolve, reject) => {
			const srcFolder = path.dirname(src)
			const dstFolder = path.dirname(dst)
			const srcFileName = path.basename(src)
			const dstFileName = path.basename(dst)
			const rbcpy = cp.spawn('robocopy', ['/bytes', '/njh', '/njs', srcFolder, dstFolder, srcFileName])

			const errors: string[] = []
			let output: string[] = []

			rbcpy.stdout.on('data', (data) => {
				const m = data.toString().trim().match(/(\d+)\.?(\d+)\%$/) // match the last reported number in the output 
				if (m) {
					const number = (parseInt(m[1]) + (parseInt(m[2]) / Math.pow(10, m[2].length))) / 100
					if (typeof progress === 'function') {
						progress(number)
					}
				}
				output.push(data.toString())
			})

			rbcpy.stderr.on('data', (data) => {
				errors.push(data.toString().trim())
			})

			rbcpy.on('close', (code) => {
				if (code === 1) { // Robocopy's code for succesfully copying files is 1: https://ss64.com/nt/robocopy-exit.html
					if (srcFileName !== dstFileName) {
						fs.rename(path.join(dstFolder, srcFileName), path.join(dstFolder, dstFileName), (err) => {
							if (err) {
								reject(err)
								return
							}
							resolve()
						})
					} else {
						resolve()
					}
				} else {
					reject(`RoboCopy failed with code ${code}: ${output.join(', ')}, ${errors.join(', ')}`)
				}
			})
		})
	}
}
