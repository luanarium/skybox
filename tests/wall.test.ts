import * as assert from "node:assert";
import {
	narrowWall,
	postFromNote,
	wallItem,
	wallSourceOf,
	wallTag,
	isKeptPost,
	frontFromText,
	quoteIds,
	WALL_FOLLOWS,
	WALL_PREFIX,
} from "../src/wall";
import { keptNote } from "../src/components/WallOverlay";
import { toChip } from "../src/search";
import type { WallPost } from "../src/mastodon";

const post = (id: string, text: string, tags: string[] = [], media: string[] = []): WallPost => ({
	id,
	url: `https://example.social/@someone/${id}`,
	author: "Someone",
	handle: "someone@example.social",
	accountId: "acc1",
	avatar: "https://example.social/avatar.png",
	text,
	media,
	tags,
	at: Date.parse("2026-10-18T09:00:00Z"),
	repliesCount: 2,
	favouritesCount: 7,
	reblogsCount: 1,
	boosted: false,
	favourited: false,
	entryId: id,
	boostedBy: "",
});

// A chip beginning `#!` asks the fediverse; everything else asks the vault.
assert.strictEqual(WALL_PREFIX, "!");
assert.strictEqual(wallTag(toChip("#!tea")!), "tea");
assert.strictEqual(wallTag(toChip("#!Tea")!), "tea", "a tag is a tag whatever its case");
assert.strictEqual(wallTag(toChip("#tea")!), null, "a plain tag is the vault's");
assert.strictEqual(wallTag(toChip("tea")!), null);
assert.deepStrictEqual(wallSourceOf([toChip("cup")!, toChip("#!tea")!]), { kind: "tag", tag: "tea" });
assert.strictEqual(wallSourceOf([toChip("#tea")!]), null);
assert.strictEqual(wallSourceOf([]), null);

// `#!follows` asks for the people you follow rather than for a hashtag.
assert.deepStrictEqual(wallSourceOf([toChip(`#!${WALL_FOLLOWS}`)!]), {
	kind: "home",
	tag: "follows",
});

// A post becomes a card without a file behind it.
const card = wallItem(post("1", "a pot of oolong", ["tea"], ["https://example.social/pic.jpg"]));
assert.strictEqual(card.id, "wall:1");
assert.strictEqual(card.kind, "note");
assert.strictEqual(card.title, "Someone");
assert.strictEqual(card.excerpt, "a pot of oolong");
assert.strictEqual(card.preview, "https://example.social/pic.jpg");
assert.deepStrictEqual(card.tags, ["tea"]);
assert.ok(card.remote, "a card from the wall says so");
assert.ok(card.file.path.startsWith("wall:"), "its file is a stand-in nothing touches");

// The other chips narrow the wall, and the wall's own chip is not a filter.
const posts = [post("1", "a pot of oolong", ["tea"]), post("2", "coffee instead", ["tea"])];
const chips = [toChip("#!tea")!, toChip("oolong")!];
assert.deepStrictEqual(narrowWall(posts, chips, "tea").map((each) => each.id), ["1"]);
assert.deepStrictEqual(narrowWall(posts, [toChip("#!tea")!], "tea").map((each) => each.id), ["1", "2"]);
assert.deepStrictEqual(narrowWall(posts, [toChip("someone")!], "tea").map((each) => each.id), ["1", "2"]);

// Keeping one writes the properties a clipped page carries, plus the id the
// conversation needs.
const note = keptNote(post("9", "a pot of oolong", ["tea", "pottery"], ["https://example.social/p.jpg"]));
assert.ok(note.includes("source: https://example.social/@someone/9"), note);
assert.ok(note.includes('mastodon_id: "9"'), note);
assert.ok(note.includes("image: https://example.social/p.jpg"), note);
assert.ok(note.includes("  - wall"), note);
assert.ok(note.includes("  - tea"), note);
assert.ok(note.includes("a pot of oolong"), note);
assert.ok(note.includes("author: \"@someone@example.social\""), note);

// A kept post reads back out of its note, so it is drawn the same way it was
// on the wall rather than shown as markdown to edit.
const keptAgain = keptNote(post("9", "a pot of oolong", ["tea"], ["https://example.social/p.jpg"]));
const front = {
	title: "Someone",
	source: "https://example.social/@someone/9",
	author: "@someone@example.social",
	created: "2026-10-18",
	mastodon_id: "9",
	mastodon_url: "https://example.social/@someone/9",
	mastodon_account: "acc1",
	image: "https://example.social/p.jpg",
	tags: ["wall", "tea"],
};
const back = postFromNote(front, keptAgain);
assert.ok(back);
assert.strictEqual(back.id, "9");
assert.strictEqual(back.author, "Someone");
assert.strictEqual(back.handle, "someone@example.social");
assert.strictEqual(back.accountId, "acc1", "the account id is what follow needs");
assert.deepStrictEqual(back.media, ["https://example.social/p.jpg"]);
assert.ok(back.text.includes("a pot of oolong"), back.text);
assert.ok(!back.text.includes("---"), "the frontmatter is not the post");
assert.ok(!back.text.includes("https://example.social/@someone/9"), "nor is the link at the foot");

// A note that was never a post reads back as nothing rather than as a blank one.
assert.strictEqual(postFromNote({ title: "an ordinary note" }, "words"), null);

// A kept post is told from a note you shared yourself by the `wall` tag, since
// both carry a status id.
assert.strictEqual(isKeptPost({ mastodon_id: "12", tags: ["wall", "tea"] }), true);
assert.strictEqual(isKeptPost({ mastodon_id: "12", tags: "#wall #tea" }), true, "tags may be a line");
assert.strictEqual(
	isKeptPost({ mastodon_id: "12", tags: ["bookmark"] }),
	false,
	"a note you shared is yours to edit"
);
assert.strictEqual(isKeptPost({ tags: ["wall"] }), false, "no status, no post");
assert.strictEqual(isKeptPost(undefined), false);
assert.strictEqual(isKeptPost({}), false);

// A status id is eighteen digits, which is more than a number holds exactly,
// so it has to come back as the digits that were written.
const big = post("115398012345678901", "oolong, slowly", ["tea"]);
const bigNote = keptNote(big);
assert.ok(bigNote.includes('mastodon_id: "115398012345678901"'), "the id is quoted");
const read = frontFromText(bigNote);
assert.strictEqual(read.mastodon_id, "115398012345678901");
assert.strictEqual(read.mastodon_account, "acc1");
assert.deepStrictEqual(read.tags, ["wall", "tea"]);
assert.strictEqual(read.source, big.url);

// And the note reads back whole even before Obsidian has parsed it, which is
// what kept a post opened a moment after keeping from coming up blank.
const uncached = postFromNote({}, bigNote);
assert.ok(uncached, "a note is enough on its own");
assert.strictEqual(uncached.id, "115398012345678901");
assert.strictEqual(uncached.accountId, "acc1");
assert.strictEqual(uncached.text, "oolong, slowly");
assert.notStrictEqual(
	String(Number(uncached.id)),
	uncached.id,
	"the point being that a number could not have carried it"
);

// Nothing before the words is nothing to read.
assert.deepStrictEqual(frontFromText("no properties here"), {});

// A post kept before the ids were quoted is put right where it is found, and
// one kept since is left alone.
const bare = bigNote
	.replace('mastodon_id: "115398012345678901"', "mastodon_id: 115398012345678901")
	.replace('mastodon_account: "acc1"', "mastodon_account: acc1");
const put = quoteIds(bare);
assert.ok(put, "bare ids are something to put right");
assert.ok(put.includes('mastodon_id: "115398012345678901"'));
assert.ok(put.includes('mastodon_account: "acc1"'));
assert.strictEqual(put.split("---\n")[2], bare.split("---\n")[2], "the words are untouched");
assert.strictEqual(quoteIds(bigNote), null, "nothing to do is nothing written");
assert.strictEqual(quoteIds("no properties here"), null);
