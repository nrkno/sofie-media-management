declare module 'windows-network-drive' {
	export type Dictionary<T> = {
		[key: string]: T
	}
	export function find(drivePath: string): Promise<string[]>
	export function list(): Promise<Dictionary<string>>
	export function mount(
		drivePath: string,
		driveLetter?: string,
		username?: string,
		password?: string
	): Promise<string>
	export function unmount(driveLetter: string): Promise<void>
	export function pathToWindowsPath(drivePath: string): Promise<string>
	export function isWinOs(): boolean
}
