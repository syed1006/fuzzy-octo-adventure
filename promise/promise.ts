type ResolveCallback<T = any> = (value: T) => void;
type RejectCallback = (reason?: unknown) => void;
type PromiseCallback = (
	resolve: ResolveCallback,
	reject: RejectCallback
) => void;

type PromiseState = "pending" | "fullfilled" | "rejected";

type OnFulfilled<T, TResult> =
	| ((value: T) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnRejected<TResult> =
	| ((reason: any) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnFinally = (() => void) | null | undefined;

type Handler<T> = {
	onfulfilled?: OnFulfilled<T, any>;
	onrejected?: OnRejected<any>;
	resolve: ResolveCallback;
	reject: RejectCallback;
};

class MyPromise<T> implements Promise<T> {
	private state: PromiseState = "pending";
	private value: any;
	private handlers: Handler<T>[] = [];

	readonly [Symbol.toStringTag]: string = "MyPromise";

	constructor(executor: PromiseCallback) {
		const resolve: ResolveCallback = (value: T) => {
			if (this.state !== "pending") return;
			this.state = "fullfilled";
			this.value = value;
			this.runHandlers();
		};
		const reject: RejectCallback = (reason: unknown) => {
			if (this.state !== "pending") return;
			this.state = "rejected";
			this.value = reason;
			this.runHandlers();
		};

		try {
			executor(resolve, reject);
		} catch (error) {
			reject(error);
		}
	}

	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: OnFulfilled<T, TResult1>,
		onrejected?: OnRejected<TResult2>
	): MyPromise<TResult1 | TResult2> {
		return new MyPromise<TResult1 | TResult2>((resolve, reject) => {
			this.handlers.push({
				onfulfilled,
				onrejected,
				resolve,
				reject,
			});

			this.runHandlers();
		});
	}

	catch<TResult = never>(
		onrejected?:
			| ((reason: any) => TResult | PromiseLike<TResult>)
			| null
			| undefined
	): MyPromise<T | TResult> {
		return this.then(undefined, onrejected);
	}

	finally(onfinally?: OnFinally): MyPromise<T> {
		// TODO (2026-02-18 11:39):
		//  MyPromise.resolve(onFinally?.()).then(() => value),
		const passThroughFulfilled: OnFulfilled<T, any> = (value: unknown) => {
			if (onfinally) {
				onfinally();
			}
			return value;
		};

		// TODO (2026-02-18 11:40):
		// MyPromise.resolve(onFinally?.()).then(() => { throw reason; })
		const passThroughRejected: OnRejected<any> = (reason: unknown) => {
			if (onfinally) {
				onfinally();
			}
			throw reason;
		};
		return this.then<T>(passThroughFulfilled, passThroughRejected);
	}

	private runHandlers() {
		if (this.state === "pending") {
			return;
		}

		this.handlers.forEach((handler) => {
			if (this.state === "fullfilled") {
				if (!handler.onfulfilled) {
					handler.resolve(this.value);
				} else {
					try {
						const result = handler.onfulfilled(this.value);
						handler.resolve(result);
					} catch (error) {
						handler.reject(error);
					}
				}
			}

			if (this.state === "rejected") {
				if (!handler.onrejected) {
					handler.reject(this.value);
				} else {
					try {
						const result = handler.onrejected(this.value);
						handler.reject(result);
					} catch (error) {
						handler.reject(error);
					}
				}
			}
		});
		this.handlers = [];
	}
}

new Promise<string>((resolve, reject) => {}).then();

Promise;
