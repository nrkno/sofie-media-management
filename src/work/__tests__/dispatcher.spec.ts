import { Dispatcher } from '../dispatcher'
import { LocalStorageGenerator } from '../__mocks__/localStorageGenerator'
import { LocalFolderHandler } from '../__mocks__/localFolderHandler'

describe('Dispatcher', () => {
	const localGen = new LocalStorageGenerator()
	const localFolder = new LocalFolderHandler()
	const disp = new Dispatcher ([
		localGen
	], [
		localFolder
	], )

	beforeAll(() => {

	})

	it('initializes it\'s workflow generators', () => {
		
	})

	it('receives new WorkFlows and starts processing', () => {

	})

	it('fills up available workers', () => {

	})

	it('blocks following WorkSteps on a WorkStep error', () => {

	})

	it('sets WorkFlow status once all WorkSteps are complete', () => {

	})

	it('sets WorkFlow status once one WorkStep fails', () => {

	})
})