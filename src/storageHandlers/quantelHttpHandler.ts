import { EventEmitter } from 'events'
import { StorageHandler, File, FileProperties, StorageEventType } from './storageHandler'
import { QuantelHTTPStorage, StorageType } from '../api'
import { Transform } from 'class-transformer'
import * as stream from 'stream'
import * as http from 'http'
import * as _ from 'underscore'
import { literal, atomicPromise } from '../lib/lib'
import { QuantelGateway } from 'tv-automation-quantel-gateway-client'
import { CancelablePromise } from '../lib/cancelablePromise'

function getHTTPProperties(gateway: QuantelGateway, url: string): Promise<FileProperties> {
	if (!gateway.initialized) throw Error(`Quantel Gateway not initialized`)
	const query = parseQuantelUrl(url)
	return gateway.searchClip(query).then(result => {
		if (result.length > 0) {
			const clip = result[0]
			return literal<FileProperties>({
				created: new Date(clip.Created).getTime(),
				modified: new Date(clip.Created).getTime(),
				size: parseInt(clip.Frames, 10)
			})
		} else {
			throw Error(`Clip not found in Quantel ISA`)
		}
	})
}

interface QuantelHTTPQuery {
	Title?: string
	ClipGUID?: string

	[index: string]: string | number | undefined
}

function parseQuantelUrl(url: string): QuantelHTTPQuery {
	if (!url.startsWith('quantel:')) throw Error(`Incompatible URL format: ${url}`)
	const query = url.substr(8)
	if (query.startsWith('?')) {
		return {
			Title: query.substr(1)
		}
	} else {
		return {
			ClipGUID: query
		}
	}
}

interface QuantelGatewayTombstone {
	gatewayUrl: string
	ISAUrl: string
	zoneId: string | undefined
	serverId: number
}

let QuantelGatewaySingleton: QuantelGateway

export class QuantelHTTPFile implements File {
	source = StorageType.QUANTEL_HTTP
	private _name: string
	private _url: string
	private _read: boolean

	@Transform(
		({ value }): QuantelGatewayTombstone => {
			return {
				gatewayUrl: value.gatewayUrl,
				ISAUrl: value.ISAUrl,
				zoneId: value.zoneId,
				serverId: value.serverId
			}
		},
		{
			toPlainOnly: true
		}
	)
	@Transform(({}) => QuantelGatewaySingleton, { toClassOnly: true })
	private gateway: QuantelGateway

	private transformerUrl: string
	private query: QuantelHTTPQuery

	constructor(gateway: QuantelGateway, transformerUrl: string, url: string, read: boolean, _name?: string)
	constructor(gateway: QuantelGateway, transformerUrl: string, url?: string, read?: boolean, _name?: string) {
		this.gateway = gateway
		this.transformerUrl = transformerUrl
		if (url) {
			this._url = decodeURIComponent(url)
			this.query = parseQuantelUrl(this._url)
			this._name = url
			this._read = !!read
		}
	}

	get name(): string {
		return this._name
	}

	get url(): string {
		return this._url
	}

	async getWritableStream(): Promise<stream.Writable> {
		throw Error(`File "${this._url}" is not writeable.`)
	}

	async getReadableStream(): Promise<stream.Readable> {
		if (!this._read) throw Error(`File "${this._url}" is not readable.`)
		return new Promise<stream.Readable>((resolve, reject) => {
			console.log(`Looking for clip ${JSON.stringify(this.query)}`)
			this.gateway
				.searchClip(this.query)
				.then(result => {
					if (result.length > 0) {
						const clip = result[0]
						if (parseInt(clip.Frames, 10) > 0) {
							console.log(`Non 0-length clip found: ${clip.ClipID}. Requesting over HTTP`)
							atomicPromise(
								'quantelTransformer',
								(): Promise<void> => {
									return new Promise<void>((resolveAtomic, rejectAtomic) => {
										http.get(
											`${this.transformerUrl}/quantel/homezone/clips/ports/${clip.ClipID}/essence.mxf`
										)
											.on('response', (data: http.IncomingMessage) => {
												if (data.statusCode === 200) {
													console.log(
														`Headers received: ${data.statusCode} ${data.statusMessage}`
													)
													resolve(data)
													resolveAtomic()
												} else {
													reject(data.statusMessage)
													rejectAtomic()
												}
											})
											.on('error', err => {
												reject(err)
												rejectAtomic()
											})
											.on('close', () => {
												console.log(`Connection closed on ${clip.ClipID}. Begin cooldown.`)
												setTimeout(function() {
													resolveAtomic()
												}, 3000)
											})
									})
								}
							).catch(e => console.error(`HTTP request failed`, e))
						} else {
							throw Error(`Clip found, but 0-length`)
						}
					} else {
						throw Error(`Clip not found in Quantel ISA`)
					}
				})
				.catch(e => reject(e))
		})
	}

	async getProperties(): Promise<FileProperties> {
		return getHTTPProperties(this.gateway, this._url).then(props => {
			if (props.size === 0) throw Error(`Reserved clip: ${this._url}`)
			props.size = undefined
			return props
		})
	}
}

export class QuantelHTTPHandler extends EventEmitter implements StorageHandler {
	private gatewayUrl: string
	private ISAUrl: string
	private ISABackupUrl: string | undefined
	private zoneId: string | undefined
	private serverId: number
	private transformerUrl: string

	private _monitoredUrls: { [key: string]: boolean } = {}

	private _initialized: boolean = false
	private _readable: boolean = false

	private gateway: QuantelGateway

	private _monitor: NodeJS.Timer

	constructor(settings: QuantelHTTPStorage) {
		super()
		this.gatewayUrl = settings.options.gatewayUrl
		this.ISAUrl = settings.options.ISAUrl
		this.ISABackupUrl = settings.options.ISABackupUrl
		this.zoneId = settings.options.zoneId
		this.serverId = settings.options.serverId
		this.transformerUrl = settings.options.transformerUrl

		this._readable = settings.support.read
	}

	parseUrl(url: string): string {
		parseQuantelUrl(url)
		return encodeURIComponent(url)
	}
	getAllFiles(): Promise<File[]> {
		return Promise.resolve([])
	}
	addMonitoredFile(url: string): void {
		this._monitoredUrls[url] = false
	}
	removeMonitoredFile(url: string): void {
		delete this._monitoredUrls[url]
	}
	getFile(name: string): Promise<File> {
		if (!this._initialized) throw Error('Not initialized yet!')
		if (!this._readable) throw Error('This storage is not readable.')
		return Promise.resolve(new QuantelHTTPFile(this.gateway, this.transformerUrl, name, this._readable))
	}
	putFile(_file: File, _progressCallback?: ((progress: number) => void) | undefined): CancelablePromise<File> {
		throw Error('This storage is not writable.')
		// return new Promise<File>((resolve, reject) => {
		// 	file.getReadableStream().then((rStream) => {
		// 		const localFile = this.createFile(file)
		// 		file.getProperties().then((sourceProperties) => {
		// 			fs.ensureDir(path.dirname(localFile.url)).then(() => {
		// 				localFile.getWritableStream().then((wStream) => {
		// 					const progressMonitor = setInterval(() => {
		// 						monitorProgress(localFile, sourceProperties)
		// 					}, 1000)

		// 					function handleError(e) {
		// 						clearInterval(progressMonitor)
		// 						reject(e)
		// 					}

		// 					rStream.on('end', () => {
		// 						clearInterval(progressMonitor)
		// 						resolve(localFile)
		// 					})
		// 					rStream.on('error', handleError)
		// 					wStream.on('error', handleError)

		// 					rStream.pipe(wStream)
		// 				}, (reason) => {
		// 					reject(reason)
		// 				})
		// 			}, err => reject(err))
		// 		}, (e) => {
		// 			throw new Error(`Could not get file properties for file: "${file.name}": ${e}`)
		// 		})
		// 	}, reason => reject(reason))
		// })
	}
	deleteFile(_file: File): Promise<void> {
		throw new Error('Method not implemented.')
	}
	getFileProperties(file: File): Promise<FileProperties> {
		return getHTTPProperties(this.gateway, file.url).then(props => {
			props.size = undefined
			return props
		})
	}
	monitor(): void {
		let names = _.keys(this._monitoredUrls)
		let chain = Promise.resolve()
		for (let name in names) {
			const url = decodeURIComponent(name)
			chain = chain
				.then(() => getHTTPProperties(this.gateway, url))
				.then(props => {
					// clip was not found before
					if (this._monitoredUrls[name] === false && props.size && props.size > 0) {
						this.emit(StorageEventType.add, {
							type: StorageEventType.add,
							path: name,
							file: new QuantelHTTPFile(this.gateway, this.transformerUrl, name, this._readable)
						})
					} else if (this._monitoredUrls[name] === true && props.size === 0) {
						this.emit(StorageEventType.delete, {
							type: StorageEventType.delete,
							path: name
						})
					}
				})
				.catch(() => {
					if (this._monitoredUrls[name] === true) {
						this.emit(StorageEventType.delete, {
							type: StorageEventType.delete,
							path: name
						})
					}
				})
		}
	}
	async init(): Promise<void> {
		QuantelGatewaySingleton = this.gateway = new QuantelGateway()
		await this.gateway.init(this.gatewayUrl, this.ISAUrl, this.ISABackupUrl, this.zoneId, this.serverId)
		this._monitor = setInterval(() => this.monitor(), 5000)
		this._initialized = true
	}
	destroy(): Promise<void> {
		clearInterval(this._monitor)
		return Promise.resolve()
	}
}
