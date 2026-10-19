/**
 * A three-way line merge, so two devices that edited different parts of the
 * same note both keep their work.
 *
 * This is the shape of merge that needs no clocks and no server: given what
 * both sides started from, an edit at the top and an edit at the bottom are
 * plainly independent, and only edits to the same lines are a real argument.
 * Two phones and a laptop never agree about what time it is, and none of this
 * has to care.
 *
 * It is deliberately line-based, which is the granularity Markdown is written
 * in. Two people typing in the same paragraph collide; two people writing in
 * different paragraphs do not.
 */

/** One side's replacement of a run of base lines. An insertion has `b0 === b1`. */
interface Hunk {
	b0: number;
	b1: number;
	text: string[];
}

export type Merge =
	| { ok: true; text: string }
	| { ok: false; why: "overlap" | "too much" };

/** A pair of files this big is not something to merge without being asked. */
const LIMIT = 4_000_000;

export function merge3(base: string, mine: string, theirs: string): Merge {
	if (mine === theirs) return { ok: true, text: mine };
	if (base === mine) return { ok: true, text: theirs };
	if (base === theirs) return { ok: true, text: mine };

	const b = lines(base);
	const m = lines(mine);
	const t = lines(theirs);
	const ours = hunks(b, m);
	const yours = hunks(b, t);
	if (!ours || !yours) return { ok: false, why: "too much" };

	const out: string[] = [];
	let at = 0;
	let mi = 0;
	let ti = 0;

	while (mi < ours.length || ti < yours.length) {
		// The earliest change still to be dealt with starts the region.
		const startMine = mi < ours.length ? ours[mi].b0 : Infinity;
		const startYours = ti < yours.length ? yours[ti].b0 : Infinity;
		const mineFirst = startMine <= startYours;
		const first = mineFirst ? ours[mi++] : yours[ti++];
		const here: Hunk[] = mineFirst ? [first] : [];
		const there: Hunk[] = mineFirst ? [] : [first];
		let b0 = first.b0;
		let b1 = first.b1;

		// Anything on the other side that argues with what is already in the
		// region joins it, and may drag more in after it.
		let grew = true;
		while (grew) {
			grew = false;
			while (mi < ours.length && there.some((other) => argues(ours[mi], other))) {
				const next = ours[mi++];
				here.push(next);
				b1 = Math.max(b1, next.b1);
				grew = true;
			}
			while (ti < yours.length && here.some((other) => argues(yours[ti], other))) {
				const next = yours[ti++];
				there.push(next);
				b1 = Math.max(b1, next.b1);
				grew = true;
			}
		}

		// The base lines before the region are nobody's argument.
		for (let line = at; line < b0; line++) out.push(b[line]);
		at = b1;

		if (there.length === 0) {
			out.push(...render(b, here, b0, b1));
			continue;
		}
		if (here.length === 0) {
			out.push(...render(b, there, b0, b1));
			continue;
		}
		const said = render(b, here, b0, b1);
		const theirSaid = render(b, there, b0, b1);
		if (said.join("\n") !== theirSaid.join("\n")) return { ok: false, why: "overlap" };
		// Both made the same change, which is not a disagreement.
		out.push(...said);
	}

	for (let line = at; line < b.length; line++) out.push(b[line]);
	return { ok: true, text: out.join("\n") };
}

/**
 * Whether two changes are about the same lines.
 *
 * Overlapping runs argue. Two insertions at the same point argue, because
 * nothing says which goes first. An insertion at the point where the other
 * side's change begins does not: it belongs before it, and that order is the
 * only one either side could have meant.
 */
function argues(a: Hunk, c: Hunk): boolean {
	if (a.b0 < c.b1 && c.b0 < a.b1) return true;
	return a.b0 === c.b0 && a.b0 === a.b1 && c.b0 === c.b1;
}

/** What one side makes of a run of base lines. */
function render(base: string[], hunks: Hunk[], b0: number, b1: number): string[] {
	const out: string[] = [];
	let at = b0;
	for (const hunk of hunks) {
		// Inside the region, which for an insertion means exactly at its
		// edge: a run of no lines is not outside anything.
		if (hunk.b0 < b0 || hunk.b1 > b1) continue;
		for (let line = at; line < hunk.b0; line++) out.push(base[line]);
		out.push(...hunk.text);
		at = hunk.b1;
	}
	for (let line = at; line < b1; line++) out.push(base[line]);
	return out;
}

/**
 * Splitting on newlines alone, so joining puts the text back exactly: a file
 * ending in a newline ends in an empty line here, and keeps it.
 */
function lines(text: string): string[] {
	return text.split("\n");
}

/**
 * What one side did to the base, as runs of replaced lines.
 *
 * The longest common subsequence of the two line lists is what counts as
 * unchanged; everything between one match and the next is a hunk. The table
 * is quadratic, which is fine for notes and refused for anything that would
 * be a bad idea to merge unasked.
 */
function hunks(base: string[], side: string[]): Hunk[] | null {
	if ((base.length + 1) * (side.length + 1) > LIMIT) return null;

	const width = side.length + 1;
	const table = new Uint32Array((base.length + 1) * width);
	for (let i = base.length - 1; i >= 0; i--) {
		for (let j = side.length - 1; j >= 0; j--) {
			table[i * width + j] =
				base[i] === side[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}

	const found: Hunk[] = [];
	let i = 0;
	let j = 0;
	let b0 = 0;
	let s0 = 0;
	const flush = (bEnd: number, sEnd: number) => {
		if (bEnd === b0 && sEnd === s0) return;
		found.push({ b0, b1: bEnd, text: side.slice(s0, sEnd) });
	};

	while (i < base.length && j < side.length) {
		if (base[i] === side[j]) {
			flush(i, j);
			i++;
			j++;
			b0 = i;
			s0 = j;
			continue;
		}
		if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
		else j++;
	}
	flush(base.length, side.length);
	return found;
}
