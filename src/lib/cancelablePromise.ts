export type CancelHandler = (handler: () => void) => void
export type PromiseExecutor<T> = (
	resolve: (value?: T | PromiseLike<T> | undefined) => void,
	reject: (reason?: any) => void,
	onCancel: CancelHandler
) => void

export class CancelablePromise<T> implements Promise<T> {
	private _basePromise: Promise<T>
	private _cancelHandler: (() => void) | undefined = undefined

	constructor(executor: PromiseExecutor<T>) {
		this._basePromise = new Promise((resolve, reject) => {
			executor(resolve, reject, (cancelHandler: () => void): void => {
				this._cancelHandler = cancelHandler
			})
		})
	}

	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined
	): Promise<TResult1 | TResult2> {
		return this._basePromise.then(onfulfilled, onrejected)
	}
	catch<TResult = never>(
		onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined
	): Promise<T | TResult> {
		return this._basePromise.catch(onrejected)
	}
	[Symbol.toStringTag]: 'Promise'

	cancel(): void {
		if (this._cancelHandler) {
			return this._cancelHandler()
		}
		throw new Error('This promise is not cancellable')
	}
}
