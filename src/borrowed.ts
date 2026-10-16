/**
 * Raised while the overlay has one of Obsidian's markdown leaves on loan.
 * That leaf counts as the active one as soon as it is created or clicked in,
 * which would otherwise look to the rest of the plugin as though the reader
 * had left the grid.
 */
let depth = 0;

export function isBorrowing(): boolean {
	return depth > 0;
}

/** Call the returned function once, when the leaf goes back. */
export function borrow(): () => void {
	depth++;
	let returned = false;
	return () => {
		if (returned) return;
		returned = true;
		depth--;
	};
}
