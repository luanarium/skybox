import * as assert from "node:assert";
import { merge3 } from "../src/merge";

const took = (merge: ReturnType<typeof merge3>): string => {
	assert.ok(merge.ok, `expected a merge, got ${merge.ok ? "" : merge.why}`);
	return merge.text;
};

// The case the whole thing exists for: an edit at the top and an edit at the
// bottom, neither of which the other knows about.
const base = ["one", "two", "three", "four", "five"].join("\n");
const mine = ["ONE", "two", "three", "four", "five"].join("\n");
const theirs = ["one", "two", "three", "four", "FIVE"].join("\n");
assert.strictEqual(took(merge3(base, mine, theirs)), ["ONE", "two", "three", "four", "FIVE"].join("\n"));
assert.strictEqual(
	took(merge3(base, theirs, mine)),
	["ONE", "two", "three", "four", "FIVE"].join("\n"),
	"and the same either way round"
);

// Nothing to do.
assert.strictEqual(took(merge3(base, base, base)), base);
assert.strictEqual(took(merge3(base, mine, mine)), mine, "both made the same change");
assert.strictEqual(took(merge3(base, mine, base)), mine, "only one side moved");
assert.strictEqual(took(merge3(base, base, theirs)), theirs);

// Insertions in different places, which is what adding to a note looks like.
assert.strictEqual(
	took(
		merge3(
			["# title", "", "body"].join("\n"),
			["# title", "", "a thought", "", "body"].join("\n"),
			["# title", "", "body", "", "a later thought"].join("\n")
		)
	),
	["# title", "", "a thought", "", "body", "", "a later thought"].join("\n")
);

// Appending to the end from both sides is the same lines, so it is an argument.
const appended = merge3("a\n", "a\nmine\n", "a\ntheirs\n");
assert.ok(!appended.ok && appended.why === "overlap");

// The same line, typed into on both devices.
const same = merge3(base, ["one", "TWO here", "three", "four", "five"].join("\n"), ["one", "TWO there", "three", "four", "five"].join("\n"));
assert.ok(!same.ok && same.why === "overlap");

// One side deleting what the other edited is an argument too.
const cut = merge3(base, ["one", "three", "four", "five"].join("\n"), ["one", "TWO", "three", "four", "five"].join("\n"));
assert.ok(!cut.ok && cut.why === "overlap");

// A deletion on one side and an untouched edit elsewhere is not.
assert.strictEqual(
	took(merge3(base, ["one", "three", "four", "five"].join("\n"), ["one", "two", "three", "four", "FIVE"].join("\n"))),
	["one", "three", "four", "FIVE"].join("\n")
);

// Trailing newlines survive, because a note that ends in one should keep it
// and a diff that quietly eats it rewrites every line of git history after.
assert.strictEqual(took(merge3("a\nb\n", "A\nb\n", "a\nb\n")), "A\nb\n");
assert.strictEqual(took(merge3("a\nb", "a\nb", "a\nB")), "a\nB");

// Frontmatter and a body, edited separately, which is the everyday case here:
// a tag added on the phone while the writing happened on the computer.
const note = ["---", "tags:", "  - note", "---", "", "The body."].join("\n");
const tagged = ["---", "tags:", "  - note", "  - idea", "---", "", "The body."].join("\n");
const written = ["---", "tags:", "  - note", "---", "", "The body, continued."].join("\n");
assert.strictEqual(
	took(merge3(note, tagged, written)),
	["---", "tags:", "  - note", "  - idea", "---", "", "The body, continued."].join("\n")
);

// Something far too large to merge behind somebody's back.
const huge = Array.from({ length: 3000 }, (_, at) => `line ${at}`).join("\n");
const hugeMine = huge.replace("line 0", "LINE 0");
const hugeTheirs = huge.replace("line 2999", "LINE 2999");
const refused = merge3(huge, hugeMine, hugeTheirs);
assert.ok(!refused.ok && refused.why === "too much", "a merge it cannot do is said, not guessed");
