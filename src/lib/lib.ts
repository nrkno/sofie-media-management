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
	return fileName.replace(/\\/g, '/').replace(/\.[\w]+$/i, '').toUpperCase()
}

export function getHash (str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('base64').replace(/[\+\/\=]/g, '_') // remove +/= from strings, because they cause troubles
}

export function getWorkFlowName (name: string): string {
	const label = name.split(/[\\\/]/).pop()
	return label || name
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

const keyThrottleHistory: {
	[functionName: string]: {
		args: any[]
		lastCalled: number
		timeout: NodeJS.Timer | undefined
		isPromise?: boolean
	}
} = {}

export function throttleOnKey<T extends ((key: string, ...args: any[]) => void | Promise<any>)>(fcn: T, wait: number, functionName?: string): T {
	return (function (key: string, ...args: any[]): void | Promise<any> {
		const id = (fcn.name || functionName || randomId()) + '_' + key
		if (!keyThrottleHistory[id] || (keyThrottleHistory[id].lastCalled + wait < Date.now())) {
			keyThrottleHistory[id] = {
				args,
				lastCalled: Date.now(),
				timeout: undefined,
			}
			const p = fcn(key, ...args)
			if (p) keyThrottleHistory[id].isPromise = true
			return p
		} else {
			// console.log(`Call to ${id} throttled for ${wait}ms`)
			if (keyThrottleHistory[id].timeout) {
				keyThrottleHistory[id].args = args
				keyThrottleHistory[id].lastCalled = Date.now()
				if (keyThrottleHistory[id].isPromise) {
					return Promise.resolve()
				}
			} else {
				keyThrottleHistory[id].args = args
				keyThrottleHistory[id].lastCalled = Date.now()
				keyThrottleHistory[id].timeout = setTimeout(() => {
					keyThrottleHistory[id].timeout = undefined
					keyThrottleHistory[id].lastCalled = Date.now()
					// console.log(`Calling throttled ${id} with ${key}, ${keyThrottleHistory[id].args}`)
					const p = fcn(key, ...keyThrottleHistory[id].args)
					if (p) {
						p.catch((e) => {
							console.error(`There was an error in a throttled function ${fcn.name}: ${JSON.stringify(e)}`)
						})
					}
				}, wait)
				if (keyThrottleHistory[id].isPromise) {
					return Promise.resolve()
				}
			}
		}
	}) as T
}

enum syncFunctionFcnStatus {
	WAITING = 0,
	RUNNING = 1,
	DONE = 2
}

interface SyncFunctionFcn {
	id: string
	fcn: Function
	args: Array<any>
	timeout: number
	status: syncFunctionFcnStatus
}
const syncFunctionFcns: Array<SyncFunctionFcn> = []
const syncFunctionRunningFcns: { [id: string]: number } = {}
/**
 * Only allow one instane of the function (and its arguments) to run at the same time
 * If trying to run several at the same time, the subsequent are put on a queue and run later
 * @param fcn
 * @param id0 (Optional) Id to determine which functions are to wait for each other. Can use "$0" to refer first argument. Example: "myFcn_$0,$1" will let myFcn(0, 0, 13) and myFcn(0, 1, 32) run in parallell, byt not myFcn(0, 0, 13) and myFcn(0, 0, 14)
 * @param timeout (Optional)
 */
export function atomic<T extends (finished: () => void, ...args: any[]) => void>
	(fcn: T, id0?: string, timeout: number = 10000): ((...args: any[]) => void) {
	// TODO: typing for the returned function could be improved with TypeScript 3.3

	let id = id0 || randomId()

	return (function (...args: any[]): void {
		syncFunctionFcns.push({
			id: id,
			fcn: fcn,
			args: args,
			timeout: timeout,
			status: syncFunctionFcnStatus.WAITING
		})
		evaluateFunctions()
	}) as T
}
function evaluateFunctions() {

	_.each(syncFunctionFcns, (o) => {
		if (o.status === syncFunctionFcnStatus.WAITING) {

			let runIt = false
			// is the function running?
			if (syncFunctionRunningFcns[o.id]) {
				// Yes, an instance of the function is running
				let timeSinceStart = Date.now() - syncFunctionRunningFcns[o.id]
				if (timeSinceStart > o.timeout) {
					// The function has run too long
					runIt = true
				} else {
					// Do nothing, another is running
				}
			} else {
				// No other instance of the funciton is running
				runIt = true
			}
			if (runIt) {
				o.status = syncFunctionFcnStatus.RUNNING
				syncFunctionRunningFcns[o.id] = Date.now()
				setTimeout(() => {
					const finished = () => {
						delete syncFunctionRunningFcns[o.id]
						o.status = syncFunctionFcnStatus.DONE
						evaluateFunctions()
					}
					try {
						o.fcn(finished, ...o.args)
					} catch (e) {
						finished()
					}
				}, 0)
			}
		}
	})
	for (let i = syncFunctionFcns.length - 1; i >= 0; i--) {
		if (syncFunctionFcns[i].status === syncFunctionFcnStatus.DONE) {
			syncFunctionFcns.splice(i, 1)
		}
	}
}