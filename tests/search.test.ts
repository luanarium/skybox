import * as assert from "node:assert";
import { chipLabel, plainExcerpt, search, toChip, unembedded } from "../src/search";
import { kindsOf } from "../src/kinds";
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
	track("a1.mp3", ["demo"], 0),
];

const bodies: Record<string, string> = {
	"n1.md": "apples and bread",
	"n2.md": "lisbon pastries",
	"i1.png": "a tram",
	"a1.mp3": "a loop I made",
};

const index = {
	all: () => items,
	content: async (item: Item) => bodies[item.id],
} as unknown as VaultIndex;

const found = async (...words: string[]) =>
	(await search(index, words.map((word) => toChip(word) as Chip))).map((item) => item.id);

assert.deepStrictEqual(
	await found(),
	["n1.md", "n2.md", "i1.png", "a1.mp3"],
	"an empty box shows everything, most recently modified first"
);
assert.deepStrictEqual(await found("lisbon"), ["n2.md"], "a word matches a heading or the body");
assert.deepStrictEqual(await found("#travel"), ["n2.md", "i1.png"], "#word matches tags alone");
assert.deepStrictEqual(await found("#food", "pastries"), ["n2.md"], "chips are ANDed");
assert.deepStrictEqual(await found("#travel", "apples"), [], "an AND that cannot hold is empty");
assert.deepStrictEqual(await found("tram"), ["i1.png"], "an image is searched through its sidecar");
assert.deepStrictEqual(
	await found("#demo"),
	["a1.mp3"],
	"a track is a card of its own, found by the tags in its sidecar"
);

function note(path: string, title: string, tags: string[], headings: string[], mtime: number): Item {
	return {
		id: path,
		kind: "note",
		file: { path } as Item["file"],
		sidecar: null,
		title,
		mtime,
		tags,
		kinds: [],
		headings,
		excerpt: "",
		embedded: false,
		preview: null,
		unread: false,
	};
}

function track(path: string, tags: string[], mtime: number): Item {
	return { ...image(path, tags, mtime), kind: "audio" };
}

function image(path: string, tags: string[], mtime: number, embedded = false): Item {
	return {
		id: path,
		kind: "image",
		file: { path } as Item["file"],
		sidecar: { path: `${path}.md` } as Item["file"],
		title: path,
		mtime,
		tags,
		kinds: [],
		headings: [],
		excerpt: "",
		embedded,
		preview: null,
		unread: false,
	};
}

// An image a note embeds stays out of the everything view, and comes back for
// any search at all — including the tag nothing wrote.
const embeds: Item[] = [
	note("n1.md", "Kyoto", ["travel"], ["Trams"], 3),
	image("diagram.png", ["embedded"], 2, true),
	image("i1.png", ["travel"], 1),
];
const withEmbed = {
	all: () => embeds,
	content: async () => "",
} as unknown as VaultIndex;

assert.deepStrictEqual(
	(await search(withEmbed, [], true)).map((item) => item.id),
	["n1.md", "i1.png"],
	"the everything view leaves embedded images out"
);
assert.deepStrictEqual(
	(await search(withEmbed, [], false)).map((item) => item.id),
	["n1.md", "diagram.png", "i1.png"],
	"unless the setting says otherwise"
);
assert.deepStrictEqual(
	(await search(withEmbed, [toChip("#embedded")!], true)).map((item) => item.id),
	["diagram.png"],
	"#embedded asks for exactly those"
);
assert.deepStrictEqual(
	(await search(withEmbed, [toChip("diagram")!], true)).map((item) => item.id),
	["diagram.png"],
	"and any search reaches one"
);
assert.deepStrictEqual(
	unembedded([image("a.png", [], 2, true), image("b.png", [], 1)]).map((item) => item.id),
	["b.png"]
);

// A kind is asked for with `!`, and asking for one is not asking for the word.
// Searching "video" finds a note that says it; `!video` finds what came from a
// site that serves video, whatever the note says.
{
	const videos = [
		video("watched.md", "A camera review", "https://www.youtube.com/watch?v=jQNeYbBiCKw"),
		video("heard.md", "An album", "https://artist.bandcamp.com/album/one"),
		video("read.md", "Why video killed the radio", "https://pixelmoondust.neocities.org/x"),
	];
	const index = {
		all: () => videos,
		content: async (item: Item) => item.title,
	} as unknown as VaultIndex;

	assert.deepStrictEqual(
		(await search(index, [toChip("!video")!])).map((item) => item.id),
		["watched.md"],
		"the video, not the note about video"
	);
	assert.deepStrictEqual(
		(await search(index, [toChip("!music")!])).map((item) => item.id),
		["heard.md"]
	);
	assert.deepStrictEqual(
		(await search(index, [toChip("video")!])).map((item) => item.id),
		["read.md"],
		"and the plain word is still the word: it finds the essay and misses the video"
	);
	assert.deepStrictEqual(
		(await search(index, [toChip("!video")!, toChip("camera")!])).map((item) => item.id),
		["watched.md"],
		"a kind narrows with the rest"
	);
}

// What a chip is, read off what was typed.
assert.deepStrictEqual(toChip("!video"), { text: "video", tagOnly: false, kindOnly: true });
assert.deepStrictEqual(toChip("!VIDEO"), { text: "video", tagOnly: false, kindOnly: true });
assert.deepStrictEqual(
	toChip("!amazing"),
	{ text: "!amazing", tagOnly: false },
	"a bang on a word nobody serves is part of the word"
);
assert.deepStrictEqual(toChip("#!tea"), { text: "!tea", tagOnly: true }, "the wall keeps its own");
assert.strictEqual(chipLabel(toChip("!video")!), "!video");
assert.strictEqual(chipLabel(toChip("#food")!), "#food");

function video(path: string, title: string, source: string): Item {
	const item = note(path, title, [], [], 1);
	return { ...item, kinds: kindsOf(source) };
}
