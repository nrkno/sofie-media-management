import { literal } from '../../lib/lib'
import { WorkFlow, WorkFlowSource } from '../../api'
import { WorkFlowGeneratorEventType } from '../../workflowGenerators/baseWorkFlowGenerator'
import { EventEmitter } from 'events'

export class LocalStorageGenerator extends EventEmitter {
	init = jest.fn(
		(): Promise<void> => {
			return Promise.resolve()
		}
	)
	destroy = jest.fn(
		(): Promise<void> => {
			return Promise.resolve()
		}
	)
	emitNewEvent = () => {
		this.emit(
			WorkFlowGeneratorEventType.NEW_WORKFLOW,
			literal<WorkFlow>({
				_id: 'testWorkFlow0',
				name: 'TEST FILE',
				finished: false,
				priority: 1,
				source: WorkFlowSource.LOCAL_MEDIA_ITEM,
				steps: [],
				created: Date.now(),
				success: false
			}),
			this
		)
	}
}
