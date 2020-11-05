import 'reflect-metadata'
import { MediaManager } from './mediaManager'
import { config, logPath, disableWatchdog } from './config'
import * as Winston from 'winston'

console.log('process started') // This is a message all Sofie processes log upon startup

// From https://mariusschulz.com/blog/the-unknown-type-in-typescript#narrowing-the-unknown-type
function stringifyForLogging(value: unknown): string {
	if (typeof value === 'function') {
		// Within this branch, `value` has type `Function`,
		// so we can access the function's `name` property
		const functionName = value.name || '(anonymous)'
		return `[function ${functionName}]`
	}

	if (value instanceof Date) {
		// Within this branch, `value` has type `Date`,
		// so we can call the `toISOString` method
		return value.toISOString()
	}

	return String(value)
}

// Setup logging --------------------------------------
const logger = new Winston.Logger({})
if (logPath) {
	// Log json to file, human-readable to console
	logger.add(Winston.transports.Console, {
		level: 'verbose',
		handleExceptions: true,
		json: false,
	})
	logger.add(Winston.transports.File, {
		level: 'debug',
		handleExceptions: true,
		json: true,
		filename: logPath,
	})
	logger.info('Logging to', logPath)
	// Hijack console.log:
	const orgConsoleLog = console.log
	console.log = function (...args: unknown[]) {
		// orgConsoleLog('a')
		if (args.length >= 1) {
			logger.debug(stringifyForLogging(args[0]), args.slice(1))
			orgConsoleLog(...args)
		}
	}
} else {
	// Log json to console
	logger.add(Winston.transports.Console, {
		handleExceptions: true,
		json: true,
		level: 'silly',
		stringify: (obj) => {
			obj.localTimestamp = getCurrentTime()
			return JSON.stringify(obj) // make single line
		},
	})
	logger.info('Logging to Console')
	// Hijack console.log:
	// const orgConsoleLog = console.log
	console.log = function (...args: unknown[]) {
		// orgConsoleLog('a')
		if (args.length >= 1) {
			logger.debug(stringifyForLogging(args[0]), args.slice(1))
		}
	}
}
function getCurrentTime() {
	const v = Date.now()
	return new Date(v).toISOString()
}

// Because the default NodeJS-handler sucks and wont display error properly
process.on('unhandledRejection', (e: any) => {
	logger.error('Unhandled Promise rejection:', e, e.reason || e.message, e.stack)
})
process.on('warning', (e: any) => {
	logger.warn('Unhandled warning:', e, e.reason || e.message, e.stack)
})

logger.info('------------------------------------------------------------------')
logger.info('Starting Media Manager')
if (disableWatchdog) logger.info('Watchdog is disabled!')
const manager = new MediaManager(logger)

logger.info('Core:          ' + config.core.host + ':' + config.core.port)
logger.info('------------------------------------------------------------------')
manager.init(config).catch((e) => {
	logger.error(e)
})

// @todo: remove this line of comment
