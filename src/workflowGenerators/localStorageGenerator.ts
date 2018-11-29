import { BaseWorkFlowGenerator } from './baseWorkFlowGenerator'
export * from './baseWorkFlowGenerator'

export class LocalStorageGenerator extends BaseWorkFlowGenerator {
	constructor () {
		super()
	}

	async init (): Promise<void> {
		return Promise.resolve()
	}
}
