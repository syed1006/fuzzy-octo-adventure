import * as tsNode from "ts-node";

tsNode.register({ transpileOnly: true });

import MyPromise from "../src/promise.ts";

export function resolved(value) {
	return MyPromise.resolve(value);
}

export function rejected(reason) {
	return MyPromise.reject(reason);
}

export function deferred() {
	let resolve, reject;
	const promise = new MyPromise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
