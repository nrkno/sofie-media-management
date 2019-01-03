
import { CoreConnection,
	CoreOptions,
	PeripheralDeviceAPI as P
} from 'tv-automation-server-core-integration'
import * as _ from 'underscore'
import * as Winston from 'winston'
import { DeviceConfig } from './mediaManager'
import * as fs from 'fs'

export interface CoreConfig {
	host: string,
	port: number,
	watchdog: boolean
}
export interface PeripheralDeviceCommand {
	_id: string

	deviceId: string
	functionName: string
	args: Array<any>

	hasReply: boolean
	reply?: any
	replyError?: any

	time: number // time
}
/**
 * Represents a connection to the Core
 */
export class CoreHandler {
	core: CoreConnection
	logger: Winston.LoggerInstance

	public _observers: Array<any> = []
	public deviceSettings: {[key: string]: any} = {}

	// Mediascanner statuses: temporary implementation, to be moved into casparcg device later:
	public mediaScannerStatus: P.StatusCode = P.StatusCode.GOOD
	public mediaScannerMessages: Array<string> = []

	private _deviceOptions: DeviceConfig
	private _onConnected?: () => any
	private _executedFunctions: {[id: string]: boolean} = {}
	private _coreConfig?: CoreConfig

	private _statusInitialized: boolean = false
	private _statusDestroyed: boolean = false

	constructor (logger: Winston.LoggerInstance, deviceOptions: DeviceConfig) {
		this.logger = logger
		this._deviceOptions = deviceOptions
	}

	async init (config: CoreConfig): Promise<void> {
		// this.logger.info('========')
		this._statusInitialized = false
		this._coreConfig = config
		this.core = new CoreConnection(this.getCoreConnectionOptions('Media Manager', 'MediaManager', true))

		this.core.onConnected(() => {
			this.logger.info('Core Connected!')
			this.setupObserversAndSubscriptions()
			.catch((e) => {
				this.logger.error('Core Error:', e)
			})
			if (this._onConnected) this._onConnected()
		})
		this.core.onDisconnected(() => {
			this.logger.warn('Core Disconnected!')
		})
		this.core.onError((err) => {
			this.logger.error('Core Error: ' + (err.message || err.toString() || err))
		})

		await this.core.init(config)
		this.logger.info('Core id: ' + this.core.deviceId)
		await this.setupObserversAndSubscriptions()
		this._statusInitialized = true
		await this.updateCoreStatus()
		return
	}
	async setupObserversAndSubscriptions () {
		this.logger.info('Core: Setting up subscriptions..')
		this.logger.info('DeviceId: ' + this.core.deviceId)
		await Promise.all([
			this.core.autoSubscribe('peripheralDevices', {
				_id: this.core.deviceId
			}),
			this.core.autoSubscribe('studioInstallationOfDevice', this.core.deviceId),
			this.core.autoSubscribe('peripheralDeviceCommands', this.core.deviceId)
		])
		this.logger.info('Core: Subscriptions are set up!')
		if (this._observers.length) {
			this.logger.info('Core: Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}
		// setup observers
		let observer = this.core.observe('peripheralDevices')
		observer.added = (id: string) => {
			this.onDeviceChanged(id)
		}
		observer.changed = (id1: string) => {
			this.onDeviceChanged(id1)
		}
		this.setupObserverForPeripheralDeviceCommands(this)
		return
	}
	async destroy (): Promise<void> {
		this._statusDestroyed = true
		await this.updateCoreStatus()
		await this.core.destroy()
	}
	getCoreConnectionOptions (name: string, subDeviceId: string, parentProcess: boolean): CoreOptions {
		let credentials

		if (this._deviceOptions.deviceId && this._deviceOptions.deviceToken) {
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: this._deviceOptions.deviceToken
			}
		} else if (this._deviceOptions.deviceId) {
			this.logger.warn('Token not set, only id! This might be unsecure!')
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: 'unsecureToken'
			}
		} else {
			credentials = CoreConnection.getCredentials(subDeviceId)
		}
		let options: CoreOptions = _.extend(credentials, {
			deviceType: P.DeviceType.MEDIA_MANAGER,
			deviceName: name,
			watchDog: (this._coreConfig ? this._coreConfig.watchdog : true)
		})
		if (parentProcess) options.versions = this._getVersions()
		return options
	}
	onConnected (fcn: () => any) {
		this._onConnected = fcn
	}
	onDeviceChanged (id: string) {
		if (id === this.core.deviceId) {
			let col = this.core.getCollection('peripheralDevices')
			if (!col) throw new Error('collection "peripheralDevices" not found!')

			let device = col.findOne(id)
			if (device) {
				this.deviceSettings = device.settings || {}
			} else {
				this.deviceSettings = {}
			}

			let logLevel = (
				this.deviceSettings['debugLogging'] ?
				'debug' :
				'info'
			)
			if (logLevel !== this.logger.level) {
				this.logger.level = logLevel

				this.logger.info('Loglevel: ' + this.logger.level)

				this.logger.debug('Test debug logging')
				// @ts-ignore
				this.logger.debug({ msg: 'test msg' })
				// @ts-ignore
				this.logger.debug({ message: 'test message' })
				// @ts-ignore
				this.logger.debug({ command: 'test command', context: 'test context' })

				this.logger.debug('End test debug logging')
			}
		}
	}
	get logDebug (): boolean {
		return !!this.deviceSettings['debugLogging']
	}

	executeFunction (cmd: PeripheralDeviceCommand, fcnObject: any) {
		if (cmd) {
			if (this._executedFunctions[cmd._id]) return // prevent it from running multiple times
			this.logger.info(cmd.functionName, cmd.args)
			this._executedFunctions[cmd._id] = true
			// console.log('executeFunction', cmd)
			let cb = (err: any, res?: any) => {
				// console.log('cb', err, res)
				if (err) {
					this.logger.error('executeFunction error', err, err.stack)
				}
				this.core.callMethod(P.methods.functionReply, [cmd._id, err, res])
				.then(() => {
					// console.log('cb done')
				})
				.catch((e) => {
					this.logger.error(e)
				})
			}
			// @ts-ignore
			let fcn: Function = fcnObject[cmd.functionName]
			try {
				if (!fcn) throw Error('Function "' + cmd.functionName + '" not found!')

				Promise.resolve(fcn.apply(fcnObject, cmd.args))
				.then((result) => {
					cb(null, result)
				})
				.catch((e) => {
					cb(e.toString(), null)
				})
			} catch (e) {
				cb(e.toString(), null)
			}
		}
	}
	retireExecuteFunction (cmdId: string) {
		delete this._executedFunctions[cmdId]
	}
	setupObserverForPeripheralDeviceCommands (functionObject: CoreHandler) {
		let observer = functionObject.core.observe('peripheralDeviceCommands')
		functionObject.killProcess(0)
		functionObject._observers.push(observer)
		let addedChangedCommand = (id: string) => {
			let cmds = functionObject.core.getCollection('peripheralDeviceCommands')
			if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')
			let cmd = cmds.findOne(id) as PeripheralDeviceCommand
			if (!cmd) throw Error('PeripheralCommand "' + id + '" not found!')
			// console.log('addedChangedCommand', id)
			if (cmd.deviceId === functionObject.core.deviceId) {
				this.executeFunction(cmd, functionObject)
			} else {
				// console.log('not mine', cmd.deviceId, this.core.deviceId)
			}
		}
		observer.added = (id: string) => {
			addedChangedCommand(id)
		}
		observer.changed = (id: string) => {
			addedChangedCommand(id)
		}
		observer.removed = (id: string) => {
			this.retireExecuteFunction(id)
		}
		let cmds = functionObject.core.getCollection('peripheralDeviceCommands')
		if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')
		cmds.find({}).forEach((cmd: PeripheralDeviceCommand) => {
			if (cmd.deviceId === functionObject.core.deviceId) {
				this.executeFunction(cmd, functionObject)
			}
		})
	}
	killProcess (actually: number) {
		if (actually === 1) {
			this.logger.info('KillProcess command received, shutting down in 1000ms!')
			setTimeout(() => {
				process.exit(0)
			}, 1000)
			return true
		}
		return 0
	}
	/* devicesMakeReady (okToDestroyStuff?: boolean): Promise<any> {
		// TODO: perhaps do something here?
		return Promise.resolve()
	}
	devicesStandDown (okToDestroyStuff?: boolean): Promise<any> {
		// TODO: perhaps do something here?
		return Promise.resolve()
	} */
	pingResponse (message: string) {
		this.core.setPingResponse(message)
		return true
	}
	getSnapshot (): any {
		this.logger.info('getSnapshot')

		// TODO: collect some proper data here to send to Core, so it can create a nice debug report
		return {
			// mediaFiles: myMediaFiles,
			// transferStatus: myTransferStatus,
		}
	}
	updateCoreStatus (): Promise<any> {
		let statusCode = P.StatusCode.GOOD
		let messages: Array<string> = []

		if (this.mediaScannerStatus !== P.StatusCode.GOOD) {
			statusCode = this.mediaScannerStatus
			if (this.mediaScannerMessages) {
				_.each(this.mediaScannerMessages, (msg) => {
					messages.push(msg)
				})
			}
		}
		if (!this._statusInitialized) {
			statusCode = P.StatusCode.BAD
			messages.push('Starting up...')
		}
		if (this._statusDestroyed) {
			statusCode = P.StatusCode.BAD
			messages.push('Shut down')
		}

		return this.core.setStatus({
			statusCode: statusCode,
			messages: messages
		})
	}
	private _getVersions () {
		let versions: {[packageName: string]: string} = {}

		if (process.env.npm_package_version) {
			versions['_process'] = process.env.npm_package_version
		}

		let dirNames: Array<string> = [
			// TODO: add any relevant sub-libraries here, to report to Core
			'tv-automation-server-core-integration',
			// 'timeline-state-resolver',
		]
		try {
			let nodeModulesDirectories = fs.readdirSync('node_modules')
			_.each(nodeModulesDirectories, (dir) => {
				try {
					if (dirNames.indexOf(dir) !== -1) {
						let file = 'node_modules/' + dir + '/package.json'
						file = fs.readFileSync(file, 'utf8')
						let json = JSON.parse(file)
						versions[dir] = json.version || 'N/A'
					}
				} catch (e) {
					this.logger.error(e)
				}
			})
		} catch (e) {
			this.logger.error(e)
		}
		return versions
	}

}
