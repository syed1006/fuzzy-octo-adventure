function add() {}

add.then = (_, func) => {
	return func("fuck works");
};

const promise = new Promise((resolve, reject) => {
	resolve(add);
})
	.then(console.log)
	.catch((r) => {
		console.error("reason", r);
	});
