import { EventEmitter } from 'events'
import { WorkFlow } from '../api'
import { LoggerInstance } from 'winston'

export enum WorkFlowGeneratorEventType {
	NEW_WORKFLOW = 'newworkflow',
}

export abstract class BaseWorkFlowGenerator extends EventEmitter {
	constructor(_logger: LoggerInstance) {
		super()

		// TODO: generic setup
	}

	on(
		type: WorkFlowGeneratorEventType.NEW_WORKFLOW,
		listener: (flow: WorkFlow, generator?: BaseWorkFlowGenerator) => void
	): this {
		return super.on(type, listener)
	}

	abstract async init(): Promise<void>
	abstract async destroy(): Promise<void>
}
