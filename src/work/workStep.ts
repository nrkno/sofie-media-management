import { Type, Transform, plainToClass, classToPlain } from 'class-transformer'
import { WorkStepBase, WorkStepAction, WorkStepStatus } from '../api'
import { File, StorageObject } from '../storageHandlers/storageHandler'
import { LocalFolderFile } from '../storageHandlers/localFolderHandler'

export class WorkStep extends WorkStepBase {
	_id: string
	_rev?: string
	workFlowId: string
}

export class FileWorkStep extends WorkStepBase {
	action: WorkStepAction.COPY | WorkStepAction.DELETE | WorkStepAction.GENERATE_METADATA | WorkStepAction.GENERATE_THUMBNAIL
	status = WorkStepStatus.IDLE
	priority = 1

	@Type(() => File, {
		discriminator: {
			property: '__type',
			subTypes: [
				{ value: LocalFolderFile, name: 'localFolderFile' }
			]
		}
	})
	file: File

	@Transform((value: StorageObject) => value.id, { toPlainOnly: true })
	@Transform((value: string) => value, { toClassOnly: true })
	target: StorageObject

	constructor (init?: Partial<FileWorkStep>) {
		super(init)
	}
}

export function workStepToPlain (obj: WorkStep): object {
	return classToPlain(obj)
}

export function plainToWorkStep (obj: object, availableStorage: StorageObject[]): WorkStep {
	const action = obj['action'] as WorkStepAction
	switch (action) {
		case WorkStepAction.COPY:
		case WorkStepAction.DELETE:
		case WorkStepAction.GENERATE_METADATA:
		case WorkStepAction.GENERATE_THUMBNAIL:
			try {
				const cls = plainToClass(FileWorkStep, obj)
				const storageId = cls.target as any as string
				const storage = availableStorage.find((i) => i.id === storageId)
				if (!storage) throw new Error(`Unknown storage: "${storageId}"`)
				cls.target = storage
				return cls as any as WorkStep
			} catch (e) {
				throw new Error(`Error when deserializing WorkStep: ${e}`)
			}

		default:
			throw new Error(`Could not deserialize work step: unknown action: "${action}"`)
	}
}
