import { atomicPromise } from '../lib'

describe('lib', () => {
	test('atomicPromise', async () => {
		const start = Date.now()
		function slow() {
			return atomicPromise('testSlow', () => {
				return new Promise<number>(resolve => {
					setTimeout(() => {
						resolve(Date.now())
					}, 100)
				})
			})
		}

		const a = await Promise.all([slow(), slow(), slow()])

		expect(Math.abs(a[0] - start - 100)).toBeLessThan(30)
		expect(Math.abs(a[1] - a[0] - 100)).toBeLessThan(30)
		expect(Math.abs(a[2] - a[1] - 100)).toBeLessThan(30)
	})
})
