import * as assert from "node:assert";
import { COVER_PALETTES, COVER_SHAPES, coverClass, coverFor } from "../src/cover";

/** Vault paths are short and similar: that is the hash's hard case. */
const PATHS = [
	"Sourdough timings.md",
	"Sourdough timings 1.md",
	"notes/Sourdough timings.md",
	"Rye starter, day four.md",
	"inbox/a.md",
	"inbox/b.md",
	"inbox/c.md",
];

// The same note is drawn the same way, every time and everywhere.
for (const path of PATHS) {
	assert.deepStrictEqual(coverFor(path), coverFor(path));
}

// Within range, and a shape that `styles.css` actually has a rule for.
for (const path of PATHS) {
	const cover = coverFor(path);
	assert.ok(cover.palette >= 0 && cover.palette < COVER_PALETTES, path);
	assert.ok(Number.isInteger(cover.palette), path);
	assert.ok(COVER_SHAPES.includes(cover.shape), path);
}

// Neighbouring names do not come out looking like each other.
assert.notDeepStrictEqual(coverFor("inbox/a.md"), coverFor("inbox/b.md"));
assert.notDeepStrictEqual(
	coverFor("Sourdough timings.md"),
	coverFor("Sourdough timings 1.md")
);

// Across a vault's worth of paths, every palette and every shape gets used.
const palettes = new Set<number>();
const shapes = new Set<string>();
for (let i = 0; i < 400; i++) {
	const cover = coverFor(`folder${i % 7}/note ${i}.md`);
	palettes.add(cover.palette);
	shapes.add(cover.shape);
}
assert.strictEqual(palettes.size, COVER_PALETTES);
assert.strictEqual(shapes.size, COVER_SHAPES.length);

// Palette and shape come from different parts of the hash, so one does not
// decide the other.
const pairs = new Set<string>();
for (let i = 0; i < 400; i++) {
	const cover = coverFor(`note ${i}.md`);
	pairs.add(`${cover.palette}/${cover.shape}`);
}
assert.ok(pairs.size > COVER_PALETTES, `only ${pairs.size} combinations`);

// The classes name the palette and the shape, for `styles.css` to pick up.
const classes = coverClass("Kyoto, three days.md");
const { palette, shape } = coverFor("Kyoto, three days.md");
assert.ok(classes.startsWith("skybox-cover "), classes);
assert.ok(classes.includes(`is-palette-${palette}`), classes);
assert.ok(classes.includes(`is-${shape}`), classes);
