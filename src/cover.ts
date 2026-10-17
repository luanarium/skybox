/**
 * Cover art for a card that has no picture of its own.
 *
 * A note is text, so the grid is a wall of words unless something is drawn for
 * it. What gets drawn is decided here and drawn in CSS: the path picks one of
 * the palettes and one of the shapes in `styles.css`, and then nudges both —
 * the hue turned a few degrees, the light lifted or dropped a little, the
 * shape moved, spaced and tilted. The nudges are bounded, so a cover still
 * looks like the palette it came from, but two notes rarely come out alike.
 *
 * The same note is drawn the same way on every machine and every rebuild,
 * because the only input is its path. Nothing is written into the vault.
 */

export const COVER_PALETTES = 8;

export const COVER_SHAPES = ["ridge", "bands", "arcs", "circles"] as const;

export type CoverShape = (typeof COVER_SHAPES)[number];

export interface Cover {
	/** Which of the palettes in `styles.css`. */
	palette: number;
	shape: CoverShape;
	/** Hue rotation in degrees, kept small so the palette survives it. */
	turn: number;
	/** Brightness multiplier, likewise. */
	lift: number;
	/** Where the shape is anchored, in percent of the cover. */
	shiftX: number;
	shiftY: number;
	/** Spacing of the repeated shapes, in pixels. */
	step: number;
	/** Tilt of the banding, in degrees. */
	tilt: number;
	/** How large the drawn shapes are, as a multiplier. */
	scale: number;
}

/**
 * FNV-1a, 32-bit: small, stable, and it spreads short similar strings — which
 * is what vault paths are — far better than adding character codes up.
 *
 * Then murmur3's finalizer over the top, because FNV-1a's low bits are not
 * independent: in a multiply, the low bits of the result come only from the
 * low bits of its inputs, so hashing one path with two different suffixes
 * leaves those bits related. Taking `% 8` and `% 4` off two such hashes read
 * that relationship straight back out — every note's shape was its palette
 * plus two. The finalizer avalanches the whole word, so any slice of it can
 * be used on its own.
 */
function hash(text: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	value ^= value >>> 16;
	value = Math.imul(value, 0x85ebca6b) >>> 0;
	value ^= value >>> 13;
	value = Math.imul(value, 0xc2b2ae35) >>> 0;
	value ^= value >>> 16;
	return value >>> 0;
}

/**
 * One knob's worth of hash. Each knob hashes the path with its own name mixed
 * in, so the knobs move independently instead of sharing bits of one number.
 */
function knob(id: string, name: string, low: number, high: number, step = 1): number {
	const steps = Math.floor((high - low) / step) + 1;
	const value = low + (hash(`${id}\u0000${name}`) % steps) * step;
	// Keep the float tidy: these end up in CSS, where 0.9400000001 helps nobody.
	return Math.round(value * 1000) / 1000;
}

export function coverFor(id: string): Cover {
	return {
		palette: knob(id, "palette", 0, COVER_PALETTES - 1),
		shape: COVER_SHAPES[knob(id, "shape", 0, COVER_SHAPES.length - 1)],
		turn: knob(id, "turn", -18, 18),
		lift: knob(id, "lift", 0.94, 1.06, 0.01),
		shiftX: knob(id, "shiftX", 12, 88),
		shiftY: knob(id, "shiftY", 104, 136),
		step: knob(id, "step", 18, 34),
		tilt: knob(id, "tilt", -14, 14),
		scale: knob(id, "scale", 0.82, 1.24, 0.02),
	};
}

/** The classes that choose the palette and the shape. */
export function coverClass(id: string): string {
	const { palette, shape } = coverFor(id);
	return `skybox-cover is-palette-${palette} is-${shape}`;
}

/**
 * The nudges, as custom properties for the stylesheet to read. Values, not
 * rules: every gradient still lives in `styles.css`, and each property is read
 * there with a fallback, so the cover draws without these too.
 */
export function coverVars(id: string): Record<string, string> {
	const cover = coverFor(id);
	return {
		"--cover-turn": `${cover.turn}deg`,
		"--cover-lift": `${cover.lift}`,
		"--cover-x": `${cover.shiftX}%`,
		"--cover-y": `${cover.shiftY}%`,
		"--cover-step": `${cover.step}px`,
		"--cover-tilt": `${cover.tilt}deg`,
		"--cover-scale": `${cover.scale}`,
	};
}
