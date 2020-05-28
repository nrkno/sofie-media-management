import { EventEmitter } from 'events'
import { WorkFlow } from '../api'
import { LogEvents } from '../lib/lib'

export enum WorkFlowGeneratorEventType {
	NEW_WORKFLOW = 'newworkflow'
}

export abstract class BaseWorkFlowGenerator extends EventEmitter {
	constructor() {
		super()

		// TODO: generic setup
	}

	on(
		type: WorkFlowGeneratorEventType.NEW_WORKFLOW | LogEvents,
		listener: (flow: WorkFlow, generator?: BaseWorkFlowGenerator) => void
	): this {
		return super.on(type, listener)
	}

	abstract async init(): Promise<void>
	abstract async destroy(): Promise<void>
}
