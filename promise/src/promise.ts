type ResolveCallback<T = any> = (value: T) => void;
type RejectCallback = (reason?: unknown) => void;
type PromiseCallback = (
	resolve: ResolveCallback,
	reject: RejectCallback
) => void;

type PromiseState = "pending" | "fulfilled" | "rejected";

type OnFulfilled<T, TResult> =
	| ((value: T) => TResult | PromiseLike<TResult>)
	| null
	| undefined
	| unknown;

type OnRejected<TResult> =
	| ((reason: any) => TResult | PromiseLike<TResult>)
	| null
	| undefined
	| unknown;

type OnFinally = (() => unknown) | null | undefined;

type Handler<T> = {
	onfulfilled?: OnFulfilled<T, any>;
	onrejected?: OnRejected<any>;
	resolve: ResolveCallback;
	reject: RejectCallback;
};

/**
 * Recursively unwraps the "awaited type" of a type. Non-promise "thenables" should resolve to `never`. This emulates the behavior of `await`.
 */
type MyAwaited<T> = T extends null | undefined
	? T // special case for `null | undefined` when not in `--strictNullChecks` mode
	: T extends object & { then(onfulfilled: infer F, ...args: infer _): any } // `await` only unwraps object types with a callable `then`. Non-object types are not unwrapped
	? F extends (value: infer V, ...args: infer _) => any // if the argument to `then` is callable, extracts the first argument
		? Awaited<V> // recursively unwrap the value
		: never // the argument to `then` was not callable
	: T; // non-object or non-thenable

class MyPromise<T> implements Promise<T> {
	private state: PromiseState = "pending";
	private value: any;
	private handlers: Handler<T>[] = [];

	readonly [Symbol.toStringTag]: string = "MyPromise";

	constructor(executor: PromiseCallback) {
		const resolve: ResolveCallback = (value: T) => {
			if (this.state !== "pending") return;

			if ((value as any) === this) {
				reject(
					new TypeError("A promise cannot be resolved with itself.")
				);
				return;
			}

			if (value instanceof MyPromise) {
				value.then(resolve, reject);
				return;
			}

			if (
				value !== null &&
				(typeof value === "object" || typeof value === "function")
			) {
				let then: any;
				try {
					then = (value as any).then;
				} catch (error) {
					reject(error);
					return;
				}
				let called = false;
				if (typeof then === "function") {
					try {
						then.call(
							value,
							(v: any) => {
								if (called) return;
								called = true;
								resolve(v);
							},
							(r: any) => {
								if (called) return;
								called = true;
								reject(r);
							}
						);
					} catch (error) {
						if (!called) {
							called = true;
							reject(error);
						}
					}
					// allow chaining until the end
					return;
				}
			}

			this.state = "fulfilled";
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
		const passThroughFulfilled: OnFulfilled<T, any> = (value: unknown) => {
			if (!onfinally) return value as T;
			return MyPromise.resolve(onfinally()).then(() => value);
		};

		const passThroughRejected: OnRejected<any> = (reason: unknown) => {
			return MyPromise.resolve(onfinally?.()).then(() => {
				throw reason;
			});
		};
		return this.then<T>(passThroughFulfilled, passThroughRejected);
	}

	private runHandlers() {
		if (this.state === "pending") {
			return;
		}

		const handlers = this.handlers;

		this.handlers = [];

		handlers.forEach((handler) => {
			const { onfulfilled, onrejected, resolve, reject } = handler;
			queueMicrotask(() => {
				if (this.state === "fulfilled") {
					if (typeof onfulfilled !== "function") {
						resolve(this.value);
					} else {
						try {
							const result = onfulfilled(this.value);
							resolve(result);
						} catch (error) {
							reject(error);
						}
					}
				}

				if (this.state === "rejected") {
					if (typeof onrejected !== "function") {
						reject(this.value);
					} else {
						try {
							const result = onrejected(this.value);
							resolve(result);
						} catch (error) {
							reject(error);
						}
					}
				}
			});
		});
	}

	static resolve(): MyPromise<void>;
	static resolve<T>(value: MyPromise<T>): MyPromise<MyAwaited<T>>;
	static resolve<T>(value: T): MyPromise<T>;
	static resolve<T>(value?: T): MyPromise<T | void> {
		if (value instanceof MyPromise) {
			return value;
		}

		return new MyPromise((resolve) => resolve(value as T));
	}

	static reject<T = never>(reason?: any): MyPromise<T> {
		return new MyPromise((_, reject) => {
			reject(reason);
		});
	}

	static all<T = any>(values: (T | MyPromise<T>)[]): MyPromise<T[] | []> {
		const promiseResults: any[] = [];
		let resolvedPromises = 0;
		return new MyPromise((resolve, reject) => {
			if (values.length === 0) {
				resolve([]);
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					.then((result: any) => {
						resolvedPromises++;
						promiseResults[index] = result;
						if (resolvedPromises === values.length) {
							resolve(promiseResults);
						}
					})
					.catch((reason) => {
						reject(reason);
					});
			});
		});
	}

	static allSettled<T = any>(
		values: (T | MyPromise<T>)[]
	): MyPromise<T[] | []> {
		const promiseResults: any[] = [];
		let resolvedPromises = 0;
		return new MyPromise((resolve) => {
			if (values.length === 0) {
				resolve([]);
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					.then((result: any) => {
						promiseResults[index] = {
							status: "fulfilled",
							value: result,
						};
					})
					.catch((reason) => {
						promiseResults[index] = {
							status: "rejected",
							reason,
						};
					})
					.finally(() => {
						resolvedPromises++;
						if (resolvedPromises === values.length) {
							resolve(promiseResults);
						}
					});
			});
		});
	}

	static race<T>(values: (T | MyPromise<T>)[]): MyPromise<MyAwaited<T>> {
		return new MyPromise((resolve, reject) => {
			values.forEach((value) => {
				MyPromise.resolve(value).then(resolve, reject);
			});
		});
	}

	static any<T>(values: (T | MyPromise<T>)[]): MyPromise<MyAwaited<T>> {
		const promiseErrors: any[] = [];
		let rejectedPromises = 0;

		return new MyPromise((resolve, reject) => {
			if (values.length === 0) {
				reject(new AggregateError([], "Values is empty."));
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					.then(resolve)
					.catch((reason) => {
						rejectedPromises++;
						promiseErrors[index] = reason;
						if (rejectedPromises === values.length) {
							reject(
								new AggregateError(
									promiseErrors,
									"All promises rejected."
								)
							);
						}
					});
			});
		});
	}
}

export default MyPromise;
