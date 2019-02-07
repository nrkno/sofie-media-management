import * as _ from 'underscore'
import * as crypto from 'crypto'
import { WorkFlow } from '../api'

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

export function getHash (str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('base64').replace(/[\+\/\=]/g, '_') // remove +/= from strings, because they cause troubles
}

export function retryNumber<T> (test: () => Promise<T>, count: number, doneSoFar?: number): Promise<T> {
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
export type Difference<A, B extends A> = Pick<B, Exclude<keyof B, keyof A>>
/**
 * Somewhat like _.extend, but with strong types & mandated additional properties
 * @param original Object to be extended
 * @param extendObj properties to add
 */
export function extendMandadory<A, B extends A> (original: A, extendObj: Difference<A, B>): B {
	return _.extend(original, extendObj)
}

export type LogEvents = 'debug' | 'info' | 'warn' | 'error'

export function getFlowHash (wf: WorkFlow): string {
	const stringified = (wf.name || 'UNNAMED') + ';' +
		wf.steps.map(i => _.values(
			_.omit(i, ['expectedLeft', 'messages', 'priority', 'progress', 'status'])
			).map(j => {
				if (typeof j === 'object') {
					return _.compact(_.values(j).map(k => typeof k === 'object' ? null : k)).join(':')
				} else {
					return j
				}
			}).join('_')
		).join(';')
	return getHash(stringified)
}
