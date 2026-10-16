import type { Compactor, Layout, LayoutItem } from "react-grid-layout";
import type { Item } from "./types";

export const ROW_HEIGHT = 8;
export const MARGIN: readonly [number, number] = [14, 14];
const MIN_COLUMN = 240;
/** On a narrow screen cards may be narrower, so a phone still gets a grid. */
const MIN_COLUMN_NARROW = 160;
const NARROW = 560;
const MAX_COLUMNS = 6;

/**
 * Places each card in the shortest column, walking the cards in result order,
 * so relevance order survives the packing.
 */
export function shortestColumnCompactor(order: Map<string, number>): Compactor {
	return {
		type: "vertical",
		allowOverlap: false,
		compact(layout: Layout, cols: number): Layout {
			const columns = new Array(Math.max(1, cols)).fill(0);
			const ordered = [...layout].sort(
				(a, b) => (order.get(a.i) ?? 0) - (order.get(b.i) ?? 0)
			);
			const placed: LayoutItem[] = [];
			for (const item of ordered) {
				let shortest = 0;
				for (let column = 1; column < columns.length; column++) {
					if (columns[column] < columns[shortest]) shortest = column;
				}
				placed.push({ ...item, x: shortest, y: columns[shortest], w: 1 });
				columns[shortest] += item.h;
			}
			return placed;
		},
	};
}

export function columnsFor(width: number): number {
	if (width <= 0) return 1;
	const minimum = width < NARROW ? MIN_COLUMN_NARROW : MIN_COLUMN;
	return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(width / minimum)));
}

/** Grid rows a pixel height occupies, given the row height and margin. */
export function rowsFor(pixels: number): number {
	return Math.max(2, Math.ceil((pixels + MARGIN[1]) / (ROW_HEIGHT + MARGIN[1])));
}

/** Guess before the first paint, so nothing jumps once measured. */
export function estimateHeight(item: Item): number {
	if (item.kind === "image") return 260;
	return 96 + Math.min(180, Math.ceil(item.excerpt.length / 40) * 22);
}
