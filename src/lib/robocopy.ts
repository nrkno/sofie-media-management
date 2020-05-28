import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { CancelablePromise } from './cancelablePromise'

export namespace robocopy {
	export function copyFile(src: string, dst: string, progress?: (progress: number) => void): CancelablePromise<void> {
		if (process.platform !== 'win32') {
			throw new Error('Only Win32 environment is supported for RoboCopy')
		}
		return new CancelablePromise<void>((resolve, reject, onCancel) => {
			const srcFolder = path.dirname(src)
			const dstFolder = path.dirname(dst)
			const srcFileName = path.basename(src)
			const dstFileName = path.basename(dst)
			let rbcpy: cp.ChildProcess | undefined = cp.spawn('robocopy', [
				'/bytes',
				'/njh',
				'/njs',
				srcFolder,
				dstFolder,
				srcFileName
			])

			const errors: string[] = []
			let output: string[] = []

			if (rbcpy.stdout){
				rbcpy.stdout.on('data', data => {
					const m = data
						.toString()
						.trim()
						.match(/(\d+)\.?(\d+)\%$/) // match the last reported number in the output
					if (m) {
						const num = (parseInt(m[1], 10) + parseInt(m[2], 10) / Math.pow(10, m[2].length)) / 100
						if (typeof progress === 'function') {
							progress(num)
						}
					}
					output.push(data.toString())
				})
			}

			if (rbcpy.stderr){
				rbcpy.stderr.on('data', data => {
					errors.push(data.toString().trim())
				})
			}

			rbcpy.on('close', code => {
				rbcpy = undefined
				if ((code & 1) === 1) {
					// Robocopy's code for succesfully copying files is 1 at LSB: https://ss64.com/nt/robocopy-exit.html
					if (srcFileName !== dstFileName) {
						fs.rename(path.join(dstFolder, srcFileName), path.join(dstFolder, dstFileName), err => {
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

			onCancel(() => {
				if (rbcpy !== undefined) {
					cp.spawn('taskkill', ['/pid', rbcpy.pid.toString(), '/f', '/t'])
				}
			})
		})
	}
}
