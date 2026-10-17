/**
 * Cover art for a card that has no picture of its own.
 *
 * A note is text, so the grid is a wall of words unless something is drawn for
 * it. The drawing is decided here and done in CSS: the path picks a palette and
 * a shape, and `styles.css` holds both, so a theme or a snippet can replace any
 * of it and nothing is written into the vault.
 *
 * The same note gets the same cover on every machine and every rebuild, because
 * the only input is its path.
 */

export const COVER_PALETTES = 8;

export const COVER_SHAPES = ["ridge", "bands", "arcs", "circles"] as const;

export type CoverShape = (typeof COVER_SHAPES)[number];

export interface Cover {
	/** Which of the palettes in `styles.css`. */
	palette: number;
	shape: CoverShape;
}

/**
 * FNV-1a, 32-bit: small, stable, and it spreads short similar strings — which
 * is what vault paths are — far better than adding character codes up.
 */
function hash(text: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value;
}

export function coverFor(id: string): Cover {
	const value = hash(id);
	return {
		palette: value % COVER_PALETTES,
		// A different slice of the hash, so palette and shape vary apart.
		shape: COVER_SHAPES[(value >>> 11) % COVER_SHAPES.length],
	};
}

/** The classes that draw it. */
export function coverClass(id: string): string {
	const { palette, shape } = coverFor(id);
	return `skybox-cover is-palette-${palette} is-${shape}`;
}
