import * as assert from "node:assert";
import { COVER_PALETTES, COVER_SHAPES, coverClass, coverFor, coverVars } from "../src/cover";

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

// Every nudge stays inside its bounds, or a cover stops looking like the
// palette it came from.
for (let i = 0; i < 400; i++) {
	const cover = coverFor(`folder${i % 5}/note ${i}.md`);
	assert.ok(cover.turn >= -18 && cover.turn <= 18, `turn ${cover.turn}`);
	assert.ok(cover.lift >= 0.94 && cover.lift <= 1.06, `lift ${cover.lift}`);
	assert.ok(cover.shiftX >= 12 && cover.shiftX <= 88, `shiftX ${cover.shiftX}`);
	assert.ok(cover.shiftY >= 104 && cover.shiftY <= 136, `shiftY ${cover.shiftY}`);
	assert.ok(cover.step >= 18 && cover.step <= 34, `step ${cover.step}`);
	assert.ok(cover.tilt >= -14 && cover.tilt <= 14, `tilt ${cover.tilt}`);
	assert.ok(cover.scale >= 0.82 && cover.scale <= 1.24, `scale ${cover.scale}`);
}

// With the nudges in, covers are effectively a fingerprint rather than one of
// thirty-two looks: 400 paths should come out very nearly all different.
const whole = new Set<string>();
for (let i = 0; i < 400; i++) {
	whole.add(JSON.stringify(coverFor(`note ${i}.md`)));
}
assert.ok(whole.size > 390, `only ${whole.size} distinct covers in 400`);

// The knobs move independently: no one of them decides another.
const byTurn = new Map<number, Set<number>>();
for (let i = 0; i < 400; i++) {
	const cover = coverFor(`note ${i}.md`);
	const seen = byTurn.get(cover.turn) ?? new Set<number>();
	seen.add(cover.palette);
	byTurn.set(cover.turn, seen);
}
assert.ok([...byTurn.values()].some((palettes) => palettes.size > 1), "turn decides palette");

// The custom properties carry units CSS can use, and nothing is undefined.
const vars = coverVars("Kyoto, three days.md");
assert.ok(vars["--cover-turn"].endsWith("deg"), vars["--cover-turn"]);
assert.ok(vars["--cover-x"].endsWith("%"), vars["--cover-x"]);
assert.ok(vars["--cover-step"].endsWith("px"), vars["--cover-step"]);
for (const [name, value] of Object.entries(vars)) {
	assert.ok(value.length > 0 && !value.includes("undefined"), `${name}: ${value}`);
	assert.ok(!value.includes("NaN"), `${name}: ${value}`);
}
assert.deepStrictEqual(coverVars("a.md"), coverVars("a.md"));
