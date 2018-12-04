export function getCurrentTime (): number {
	return Date.now()
}

export function literal<T> (arg: T) {
	return arg
}
