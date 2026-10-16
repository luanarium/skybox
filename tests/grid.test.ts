import * as assert from "node:assert";
import { columnsFor, rowsFor, shortestColumnCompactor } from "../src/compact";

const order = new Map([
	["a", 0],
	["b", 1],
	["c", 2],
	["d", 3],
]);

const layout = [
	{ i: "a", x: 0, y: 0, w: 1, h: 10 },
	{ i: "b", x: 0, y: 1, w: 1, h: 4 },
	{ i: "c", x: 0, y: 2, w: 1, h: 3 },
	{ i: "d", x: 0, y: 3, w: 1, h: 2 },
];

const packed = shortestColumnCompactor(order).compact(layout, 2);

assert.deepStrictEqual(
	packed.map((item) => [item.i, item.x, item.y, item.h]),
	[
		["a", 0, 0, 10],
		["b", 1, 0, 4],
		["c", 1, 4, 3],
		["d", 1, 7, 2],
	],
	"each card goes to the shortest column, in result order"
);

assert.deepStrictEqual(
	shortestColumnCompactor(order).compact(packed, 2),
	packed,
	"compacting an already packed layout changes nothing"
);

const shuffled = [layout[2], layout[0], layout[3], layout[1]];
assert.deepStrictEqual(
	shortestColumnCompactor(order).compact(shuffled, 2),
	packed,
	"the order comes from the result map, not from the array"
);

assert.strictEqual(
	packed.filter((item) => item.w !== 1).length,
	0,
	"every card is one column wide"
);

assert.deepStrictEqual(
	[columnsFor(0), columnsFor(300), columnsFor(760), columnsFor(4000)],
	[1, 1, 3, 6],
	"columns follow the container width, up to six"
);

assert.strictEqual(rowsFor(0), 2, "a card is never shorter than two rows");
assert.strictEqual(rowsFor(8 * 8 + 7 * 14), 8, "a pixel height maps back to its rows");
