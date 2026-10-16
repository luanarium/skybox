import * as assert from "node:assert";
import { plainExcerpt, search, toChip } from "../src/search";
import type { VaultIndex } from "../src/index";
import type { Chip } from "../src/search";
import type { Item } from "../src/types";

assert.deepStrictEqual(toChip(" #tag "), { text: "tag", tagOnly: true }, "a # means tags only");
assert.deepStrictEqual(toChip("word"), { text: "word", tagOnly: false });
assert.strictEqual(toChip("   "), null, "whitespace is not a chip");

assert.strictEqual(
	plainExcerpt(
		"---\ntags: [a]\n---\n# Title\n\nSome **bold** text with a [[link|label]] and ![img](x.png)."
	),
	"Title Some bold text with a label and img.",
	"frontmatter, markup and link syntax are stripped out of an excerpt"
);

const items: Item[] = [
	note("n1.md", "Grocery list", ["food"], [], 3),
	note("n2.md", "Trip notes", ["travel", "food"], ["Lisbon"], 2),
	image("i1.png", ["travel"], 1),
];

const bodies: Record<string, string> = {
	"n1.md": "apples and bread",
	"n2.md": "lisbon pastries",
	"i1.png": "a tram",
};

const index = {
	all: () => items,
	content: async (item: Item) => bodies[item.id],
} as unknown as VaultIndex;

const found = async (...words: string[]) =>
	(await search(index, words.map((word) => toChip(word) as Chip))).map((item) => item.id);

assert.deepStrictEqual(
	await found(),
	["n1.md", "n2.md", "i1.png"],
	"an empty box shows everything, most recently modified first"
);
assert.deepStrictEqual(await found("lisbon"), ["n2.md"], "a word matches a heading or the body");
assert.deepStrictEqual(await found("#travel"), ["n2.md", "i1.png"], "#word matches tags alone");
assert.deepStrictEqual(await found("#food", "pastries"), ["n2.md"], "chips are ANDed");
assert.deepStrictEqual(await found("#travel", "apples"), [], "an AND that cannot hold is empty");
assert.deepStrictEqual(await found("tram"), ["i1.png"], "an image is searched through its sidecar");

function note(path: string, title: string, tags: string[], headings: string[], mtime: number): Item {
	return {
		id: path,
		kind: "note",
		file: { path } as Item["file"],
		sidecar: null,
		title,
		mtime,
		tags,
		headings,
		excerpt: "",
	};
}

function image(path: string, tags: string[], mtime: number): Item {
	return {
		id: path,
		kind: "image",
		file: { path } as Item["file"],
		sidecar: { path: `${path}.md` } as Item["file"],
		title: path,
		mtime,
		tags,
		headings: [],
		excerpt: "",
	};
}
