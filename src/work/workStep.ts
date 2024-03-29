import { Type, Transform, plainToInstance, instanceToPlain } from 'class-transformer'
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
	_id: string
	_rev: string
	workFlowId: string
}

export interface FileWorkStepInitial extends WorkStepInitial {
	action:
		| WorkStepAction.COPY
		| WorkStepAction.DELETE
		| WorkStepAction.GENERATE_METADATA
		| WorkStepAction.GENERATE_PREVIEW
		| WorkStepAction.GENERATE_THUMBNAIL
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
	priority = this.priority === undefined ? 1 : this.priority

	// code annotations for class-transformer to automate serialization and deserialization
	@Type(() => File, {
		discriminator: {
			property: '__type',
			subTypes: [
				{ value: LocalFolderFile, name: 'localFolderFile' },
				{ value: QuantelHTTPFile, name: 'quantelHTTPFile' },
				{ value: QuantelStream, name: 'quantelStream' }
			]
		}
	})
	file: File

	@Transform(({ value }) => value.id, { toPlainOnly: true })
	@Transform(({ value }) => value, { toClassOnly: true })
	target: StorageObject

	constructor(init?: FileWorkStepInitialConstr) {
		super(init)
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
	priority = this.priority === undefined ? 1 : this.priority

	// code annotations for class-transformer to automate serialization and deserialization
	@Type(() => File, {
		discriminator: {
			property: '__type',
			subTypes: [
				{ value: LocalFolderFile, name: 'localFolderFile' },
				{ value: QuantelHTTPFile, name: 'quantelHTTPFile' },
				{ value: QuantelStream, name: 'quantelStream' }
			]
		}
	})
	file: File

	@Transform(({ value }) => value.id, { toPlainOnly: true })
	@Transform(({ value }) => value, { toClassOnly: true })
	target: StorageObject

	constructor(init?: ScannerWorkStepInitialConstr) {
		super(init)
	}
}

export function workStepToPlain(obj: WorkStep): object {
	return instanceToPlain(obj)
}

export function plainToWorkStep(obj: object, availableStorage: StorageObject[]): WorkStepDB {
	const action = obj['action'] as WorkStepAction
	switch (action) {
		case WorkStepAction.COPY:
		case WorkStepAction.DELETE:
		case WorkStepAction.GENERATE_METADATA:
		case WorkStepAction.GENERATE_THUMBNAIL:
		case WorkStepAction.GENERATE_PREVIEW:
		case WorkStepAction.SCAN:
			try {
				const cls = plainToInstance(FileWorkStep, obj)
				const storageId = (cls.target as any) as string

				const storage =
					storageId === 'quantelPropertiesFromMonitor'
						? literal<StorageObject>({
								// Used when streams take their configuration from the Quantel monitor
								id: 'quantelPropertiesFromMonitor',
								support: { read: false, write: false },
								handler: QuantelStreamHandlerSingleton.Instance,
								type: StorageType.QUANTEL_STREAM,
								options: {}
						  })
						: availableStorage.find(i => i.id === storageId)
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
