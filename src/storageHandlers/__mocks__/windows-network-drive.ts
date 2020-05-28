import { Dictionary } from 'underscore'

const windowsNetworkDrive = {
	find: jest.fn(
		(_drivePath: string): Promise<Array<string>> => {
			return new Promise(resolve => resolve([]))
		}
	),
	list: jest.fn(
		(): Promise<Dictionary<string>> => {
			return new Promise(resolve => resolve({}))
		}
	),
	mount: jest.fn(
		(_drivePath: string, driveLetter?: string, _username?: string, _password?: string): Promise<string> => {
			return new Promise(resolve => resolve(driveLetter))
		}
	),
	unmount: jest.fn(
		(_driveLetter: string): Promise<void> => {
			return Promise.resolve()
		}
	),
	pathToWindowsPath: jest.fn(
		(drivePath: string): Promise<string> => {
			return new Promise(resolve => resolve(drivePath))
		}
	),
	isWinOs: jest.fn((): boolean => {
		return true
	})
}
export = windowsNetworkDrive
