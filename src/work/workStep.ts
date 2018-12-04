import { WorkStep, WorkStepAction } from '../api'
import { File, StorageHandler } from '../storageHandlers/storageHandler'

export interface FileWorkStep extends WorkStep {
	file: File
}

export interface CopyWorkStep extends FileWorkStep {
	action: WorkStepAction.COPY,
	target: StorageHandler
}

export interface DeleteWorkStep extends FileWorkStep {
	action: WorkStepAction.DELETE
}

export interface GenThumbnailWorkStep extends FileWorkStep {
	action: WorkStepAction.GENERATE_THUMBNAIL
}

export interface GenMetadataWorkStep extends FileWorkStep {
	action: WorkStepAction.GENERATE_METADATA
}
