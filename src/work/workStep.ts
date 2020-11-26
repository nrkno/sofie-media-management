import { Type, Transform, plainToClass, classToPlain } from 'class-transformer'
import { WorkStep, WorkStepAction, WorkStepStatus, WorkStepInitial, StorageType } from '../api'
import { File, StorageObject } from '../storageHandlers/storageHandler'
import { LocalFolderFile } from '../storageHandlers/localFolderHandler'
import { QuantelHTTPFile } from '../storageHandlers/quantelHttpHandler'
import { literal } from '../lib/lib'
import { QuantelStreamHandlerSingleton, QuantelStream } from '../storageHandlers/quantelStreamHandler'

export type GeneralWorkStepDB = (FileWorkStep | ScannerWorkStep) & WorkStepDB

/**
 * The object that's stored in the DB
 */
export class WorkStepDB extends WorkStep {
	_id!: string
	_rev!: string
	workFlowId!: string
}

export interface FileWorkStepInitial extends WorkStepInitial {
	action: WorkStepAction.COPY | WorkStepAction.DELETE
	// | WorkStepAction.GENERATE_METADATA
	// | WorkStepAction.GENERATE_PREVIEW
	// | WorkStepAction.GENERATE_THUMBNAIL
	file: File
	target: StorageObject
}
export interface FileWorkStepInitialConstr extends FileWorkStepInitial {
	status: WorkStepStatus.IDLE
}
/**
 * The FileWorkStep is a WorkStep that performs a file operation
 */
export class FileWorkStep extends WorkStep implements FileWorkStepInitial {
	action: WorkStepAction.COPY | WorkStepAction.DELETE
	priority: number

	// code annotations for class-transformer to automate serialization and deserialization
	@Type(() => File, {
		discriminator: {
			property: '__type',
			subTypes: [
				{ value: LocalFolderFile, name: 'localFolderFile' },
				{ value: QuantelHTTPFile, name: 'quantelHTTPFile' },
				{ value: QuantelStream, name: 'quantelStream' },
			],
		},
	})
	file: File

	@Transform((value: StorageObject) => value.id, { toPlainOnly: true })
	@Transform((value: string) => value, { toClassOnly: true })
	target: StorageObject

	constructor(init: FileWorkStepInitialConstr) {
		super(init)
		this.action = init.action
		this.priority = init.priority
		this.file = init.file
		this.target = init.target
	}
}
export interface ScannerWorkStepInitial extends WorkStepInitial {
	action:
		| WorkStepAction.GENERATE_METADATA
		| WorkStepAction.GENERATE_PREVIEW
		| WorkStepAction.GENERATE_THUMBNAIL
		| WorkStepAction.SCAN
	file: File
	target: StorageObject
}
export interface ScannerWorkStepInitialConstr extends ScannerWorkStepInitial {
	status: WorkStepStatus.IDLE
}
/**
 */

export class ScannerWorkStep extends WorkStep implements ScannerWorkStepInitial {
	action:
		| WorkStepAction.GENERATE_METADATA
		| WorkStepAction.GENERATE_PREVIEW
		| WorkStepAction.GENERATE_THUMBNAIL
		| WorkStepAction.SCAN
	priority: number

	// code annotations for class-transformer to automate serialization and deserialization
	@Type(() => File, {
		discriminator: {
			property: '__type',
			subTypes: [
				{ value: LocalFolderFile, name: 'localFolderFile' },
				{ value: QuantelHTTPFile, name: 'quantelHTTPFile' },
				{ value: QuantelStream, name: 'quantelStream' },
			],
		},
	})
	file: File

	@Transform((value: StorageObject) => value.id, { toPlainOnly: true })
	@Transform((value: string) => value, { toClassOnly: true })
	target: StorageObject

	constructor(init: ScannerWorkStepInitialConstr) {
		super(init)
		this.action = init.action
		this.priority = init.priority
		this.file = init.file
		this.target = init.target
	}
}

export function workStepToPlain(obj: WorkStep): Record<string, any> {
	return classToPlain(obj)
}

export function plainToWorkStep(obj: Record<string, any>, availableStorage: StorageObject[]): WorkStepDB {
	const action = obj['action'] as WorkStepAction
	switch (action) {
		case WorkStepAction.COPY:
		case WorkStepAction.DELETE:
		case WorkStepAction.GENERATE_METADATA:
		case WorkStepAction.GENERATE_THUMBNAIL:
		case WorkStepAction.GENERATE_PREVIEW:
		case WorkStepAction.SCAN:
			try {
				const cls = plainToClass(FileWorkStep, obj)
				const storageId = (cls.target as any) as string

				const storage =
					storageId === 'quantelPropertiesFromMonitor'
						? literal<StorageObject>({
								// Used when streams take their configuration from the Quantel monitor
								id: 'quantelPropertiesFromMonitor',
								support: { read: false, write: false },
								handler: QuantelStreamHandlerSingleton.Instance,
								type: StorageType.QUANTEL_STREAM,
								options: {},
						  })
						: availableStorage.find((i) => i.id === storageId)
				if (!storage) throw new Error(`Unknown storage: "${storageId}"`)
				cls.target = storage
				return (cls as any) as WorkStepDB
			} catch (e) {
				throw new Error(`Error when deserializing WorkStep: ${e}`)
			}

		default:
			throw new Error(`Could not deserialize work step: unknown action: "${action}"`)
	}
}
