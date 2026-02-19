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
	// Spec: 27.2.6 — A Promise has an internal [[PromiseState]] slot, initially "pending"
	private state: PromiseState = "pending";

	// Spec: 27.2.6 — [[PromiseResult]] holds the fulfillment value or rejection reason
	private value: any;

	// Spec: 27.2.6 — [[PromiseFulfillReactions]] and [[PromiseRejectReactions]] store
	// reaction records queued while the promise is still pending
	private handlers: Handler<T>[] = [];

	readonly [Symbol.toStringTag]: string = "MyPromise";

	constructor(executor: PromiseCallback) {
		// Spec: 27.2.1.1 NewPromiseCapability / 27.2.2.1 Promise() constructor
		// The executor receives two functions — resolveFunction and rejectFunction —
		// built by CreateResolvingFunctions (27.2.1.3).

		const resolve: ResolveCallback = (value: T) => {
			// Spec: 27.2.1.3.2 Promise Resolve Function
			// Step 1: If the promise's [[AlreadyResolved]] flag is true, return early.
			if (this.state !== "pending") return;

			// Spec: 27.2.1.3.2 step 7 — If resolution === promise, reject with a TypeError.
			// A promise cannot be resolved with itself to prevent an infinite thenable chain.
			if ((value as any) === this) {
				reject(
					new TypeError("A promise cannot be resolved with itself.")
				);
				return;
			}

			// Spec: 27.2.1.3.2 step 8 — If the resolution is an instance of Promise
			// (same realm), we can shortcut: call Resolve/Reject directly via .then()
			// instead of going through the full thenable machinery.
			if (value instanceof MyPromise) {
				value.then(resolve, reject);
				return;
			}

			// Spec: 27.2.1.3.2 steps 9-12 — If resolution is an object or function,
			// try to retrieve its `then` property. If that throws, reject the promise.
			if (
				value !== null &&
				(typeof value === "object" || typeof value === "function")
			) {
				let then: any;
				try {
					then = (value as any).then;
				} catch (error) {
					// Spec: 27.2.1.3.2 step 10 — If [[Get]] of "then" throws, reject.
					reject(error);
					return;
				}

				// Spec: 27.2.1.3.2 step 14 — `called` flag corresponds to the
				// [[AlreadyResolved]] check inside the resolve/reject handlers passed
				// to the thenable, preventing double-resolution (Promises/A+ 2.3.3.3.3).
				let called = false;
				if (typeof then === "function") {
					// Spec: 27.2.1.3.2 step 15 — PerformPromiseThen: call the thenable's
					// `then` with the promise's resolve and reject as callbacks.
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
						// Spec: 27.2.1.3.2 step 15e — If calling `then` throws and
						// resolve/reject have not yet been called, reject the promise.
						if (!called) {
							called = true;
							reject(error);
						}
					}
					// The promise is now "locked-in" to the thenable; do not settle yet.
					return;
				}
			}

			// Spec: 27.2.1.3.2 steps 3-6 — Non-thenable value: transition state to
			// "fulfilled", store the value, then process any queued reactions.
			this.state = "fulfilled";
			this.value = value;
			this.runHandlers();
		};

		const reject: RejectCallback = (reason: unknown) => {
			// Spec: 27.2.1.3.1 Promise Reject Function
			// If already resolved, do nothing (idempotent per [[AlreadyResolved]]).
			if (this.state !== "pending") return;

			// Spec: 27.2.1.3.1 steps 3-5 — Transition to "rejected", store the reason,
			// then process queued reactions.
			this.state = "rejected";
			this.value = reason;
			this.runHandlers();
		};

		// Spec: 27.2.2.1 step 9-10 — Invoke the executor synchronously.
		// If it throws, reject the promise (same as calling the reject function).
		try {
			executor(resolve, reject);
		} catch (error) {
			reject(error);
		}
	}

	// Spec: 27.2.5.4 Promise.prototype.then ( onFulfilled, onRejected )
	// Returns a new promise that reacts to this promise's settlement.
	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: OnFulfilled<T, TResult1>,
		onrejected?: OnRejected<TResult2>
	): MyPromise<TResult1 | TResult2> {
		// Spec: 27.2.5.4 step 3 — PerformPromiseThen: create a new "child" promise
		// (the "resultCapability") and enqueue a reaction record linking the callbacks
		// to that child's resolve/reject functions.
		return new MyPromise<TResult1 | TResult2>((resolve, reject) => {
			this.handlers.push({
				onfulfilled,
				onrejected,
				resolve,
				reject,
			});

			// If the promise is already settled, trigger handler processing immediately
			// (still async via microtask — see runHandlers).
			this.runHandlers();
		});
	}

	// Spec: 27.2.5.1 Promise.prototype.catch ( onRejected )
	// Syntactic sugar: equivalent to calling .then(undefined, onRejected).
	catch<TResult = never>(
		onrejected?:
			| ((reason: any) => TResult | PromiseLike<TResult>)
			| null
			| undefined
	): MyPromise<T | TResult> {
		return this.then(undefined, onrejected);
	}

	// Spec: 27.2.5.3 Promise.prototype.finally ( onFinally )
	// Runs `onFinally` on both fulfillment and rejection, then passes the original
	// value/reason through so it doesn't change the promise's result.
	finally(onfinally?: OnFinally): MyPromise<T> {
		// Spec: 27.2.5.3 step 4 — If onFinally is not callable, use identity/thrower.
		// Otherwise wrap it so the settled value/reason is forwarded unchanged.
		const passThroughFulfilled: OnFulfilled<T, any> = (value: unknown) => {
			if (!onfinally) return value as T;
			// Spec: 27.2.5.3 step 5 — Call onFinally(), wait for its result to settle
			// (it may return a promise), then propagate the original fulfillment value.
			return MyPromise.resolve(onfinally()).then(() => value);
		};

		const passThroughRejected: OnRejected<any> = (reason: unknown) => {
			// Spec: 27.2.5.3 step 6 — Same pattern for rejection: call onFinally(),
			// wait for it, then re-throw the original reason so the chain stays rejected.
			return MyPromise.resolve(onfinally?.()).then(() => {
				throw reason;
			});
		};
		return this.then<T>(passThroughFulfilled, passThroughRejected);
	}

	private runHandlers() {
		// Spec: 27.2.2.2 PerformPromiseThen — Reactions are only processed once
		// the promise is no longer pending.
		if (this.state === "pending") {
			return;
		}

		const handlers = this.handlers;

		// Drain the handler queue so newly-added handlers from inside callbacks
		// are not double-processed in this tick.
		this.handlers = [];

		handlers.forEach((handler) => {
			const { onfulfilled, onrejected, resolve, reject } = handler;

			// Spec: 27.2.2.2 step 7/8 — Reactions must be executed asynchronously
			// as microtasks (EnqueueJob / PromiseReactionJob), never synchronously,
			// even if the promise is already settled at the time .then() is called.
			queueMicrotask(() => {
				if (this.state === "fulfilled") {
					// Spec: 27.2.2.1.1 PromiseReactionJob — If onFulfilled is not a
					// function, the child promise is resolved with the same value
					// (value "pass-through").
					if (typeof onfulfilled !== "function") {
						resolve(this.value);
					} else {
						try {
							// Spec: 27.2.2.1.1 — Call the handler; resolve the child
							// promise with its return value (which may itself be a thenable).
							const result = onfulfilled(this.value);
							resolve(result);
						} catch (error) {
							// Spec: 27.2.2.1.1 — If the handler throws, reject the child promise.
							reject(error);
						}
					}
				}

				if (this.state === "rejected") {
					// Spec: 27.2.2.1.1 — If onRejected is not a function, the child
					// promise is rejected with the same reason (reason "pass-through").
					if (typeof onrejected !== "function") {
						reject(this.value);
					} else {
						try {
							// Spec: 27.2.2.1.1 — Call the handler; if it returns normally,
							// the child promise is *fulfilled* (rejection was handled).
							const result = onrejected(this.value);
							resolve(result);
						} catch (error) {
							// Spec: 27.2.2.1.1 — If the rejection handler itself throws,
							// propagate that new error downstream.
							reject(error);
						}
					}
				}
			});
		});
	}

	// Spec: 27.2.4.5 Promise.resolve ( x )
	// If x is already a promise from the same constructor, return it directly
	// (identity shortcut). Otherwise wrap it in a new promise.
	static resolve(): MyPromise<void>;
	static resolve<T>(value: MyPromise<T>): MyPromise<MyAwaited<T>>;
	static resolve<T>(value: T): MyPromise<T>;
	static resolve<T>(value?: T): MyPromise<T | void> {
		// Spec: 27.2.4.5 step 1 — If the argument is already a promise whose
		// [[Prototype]] matches this constructor, return it as-is (no wrapping).
		if (value instanceof MyPromise) {
			return value;
		}

		return new MyPromise((resolve) => resolve(value as T));
	}

	// Spec: 27.2.4.4 Promise.reject ( r )
	// Always creates a new rejected promise; no identity shortcut unlike resolve().
	static reject<T = never>(reason?: any): MyPromise<T> {
		return new MyPromise((_, reject) => {
			reject(reason);
		});
	}

	// Spec: 27.2.4.1 Promise.all ( iterable )
	// Resolves when ALL input promises fulfill; rejects as soon as ANY rejects
	// ("fail-fast"). Preserves index order in the result array.
	static all<T = any>(values: (T | MyPromise<T>)[]): MyPromise<T[] | []> {
		const promiseResults: any[] = [];
		let resolvedPromises = 0;
		return new MyPromise((resolve, reject) => {
			// Spec: 27.2.4.1 step 5i — If the iterable is empty, resolve immediately
			// with an empty array.
			if (values.length === 0) {
				resolve([]);
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					.then((result: any) => {
						resolvedPromises++;
						// Spec: 27.2.4.1 step 5k.vi — Store results by index, not by
						// order of completion, to preserve original order.
						promiseResults[index] = result;
						// Spec: 27.2.4.1 — Resolve only when the last promise settles.
						if (resolvedPromises === values.length) {
							resolve(promiseResults);
						}
					})
					.catch((reason) => {
						// Spec: 27.2.4.1 step 5k.ix — Any single rejection immediately
						// rejects the returned promise ("fail-fast" semantics).
						reject(reason);
					});
			});
		});
	}

	// Spec: 27.2.4.2 Promise.allSettled ( iterable )
	// Waits for ALL promises to settle (fulfill OR reject) and collects their
	// outcomes. Never rejects early — reflects final state of every input.
	static allSettled<T = any>(
		values: (T | MyPromise<T>)[]
	): MyPromise<T[] | []> {
		const promiseResults: any[] = [];
		let resolvedPromises = 0;
		return new MyPromise((resolve) => {
			// Spec: 27.2.4.2 — Empty iterable resolves with an empty array.
			if (values.length === 0) {
				resolve([]);
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					.then((result: any) => {
						// Spec: 27.2.4.2 step 5k.viii — Fulfilled descriptor object.
						promiseResults[index] = {
							status: "fulfilled",
							value: result,
						};
					})
					.catch((reason) => {
						// Spec: 27.2.4.2 step 5k.ix — Rejected descriptor object.
						promiseResults[index] = {
							status: "rejected",
							reason,
						};
					})
					.finally(() => {
						// Count completions regardless of outcome; resolve once all settle.
						resolvedPromises++;
						if (resolvedPromises === values.length) {
							resolve(promiseResults);
						}
					});
			});
		});
	}

	// Spec: 27.2.4.3 Promise.race ( iterable )
	// Settles (fulfills or rejects) as soon as the FIRST input promise settles.
	// Subsequent settlements are ignored due to the [[AlreadyResolved]] guard.
	static race<T>(values: (T | MyPromise<T>)[]): MyPromise<MyAwaited<T>> {
		return new MyPromise((resolve, reject) => {
			// Spec: 27.2.4.3 — Wire resolve/reject directly; whichever fires first
			// wins; the rest are silently dropped.
			values.forEach((value) => {
				MyPromise.resolve(value).then(resolve, reject);
			});
		});
	}

	// Spec: 27.2.4.6 Promise.any ( iterable )  (ES2021)
	// Fulfills as soon as ANY input promise fulfills ("success-fast").
	// Rejects with AggregateError only if ALL promises reject.
	static any<T>(values: (T | MyPromise<T>)[]): MyPromise<MyAwaited<T>> {
		const promiseErrors: any[] = [];
		let rejectedPromises = 0;

		return new MyPromise((resolve, reject) => {
			// Spec: 27.2.4.6 step 6 — If the iterable is empty, reject immediately
			// with an AggregateError (there is no promise that could fulfill).
			if (values.length === 0) {
				reject(new AggregateError([], "Values is empty."));
				return;
			}

			values.forEach((value, index) => {
				MyPromise.resolve(value)
					// Spec: 27.2.4.6 step 8k.vi — First fulfillment wins; resolve immediately.
					.then(resolve)
					.catch((reason) => {
						rejectedPromises++;
						// Collect errors by index to preserve order for AggregateError.
						promiseErrors[index] = reason;
						// Spec: 27.2.4.6 step 8j.viii — Only after every promise has
						// rejected do we reject with an AggregateError containing all reasons.
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
