import * as _ from 'underscore'

export function getCurrentTime (): number {
	return Date.now()
}

export function literal<T> (arg: T): T {
	return arg
}

export function randomId (): string {
	return Math.random().toString(36).substring(2, 8)
}

export function getID (fileName: string): string {
	return fileName.replace('\\', '/').replace(/\.[\w]+$/i, '').toUpperCase()
}

export function retryNumber<T>(test: () => Promise<T>, count: number, doneSoFar?: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		test().then((res) => {
			resolve(res)
		}, (reason) => {
			doneSoFar = doneSoFar === undefined ? 1 : (doneSoFar + 1)
			if (doneSoFar >= count) {
				reject(reason)
			} else {
				retryNumber(test, count, doneSoFar).then(resolve, reject)
			}
		})
	})
}

/**
 * Returns the difference between object A and B
 */
type Difference<A, B extends A> = Pick<B, Exclude<keyof B, keyof A>>
/**
 * Somewhat like _.extend, but with strong types & mandated additional properties
 * @param original Object to be extended
 * @param extendObj properties to add
 */
export function extendMandadory<A, B extends A> (original: A, extendObj: Difference<A, B>): B {
	return _.extend(original, extendObj)
}

export type LogEvents = 'debug' | 'info' | 'warn' | 'error'
