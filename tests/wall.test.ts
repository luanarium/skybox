import * as assert from "node:assert";
import { narrowWall, wallItem, wallTag, wallTagOf, WALL_PREFIX } from "../src/wall";
import { keptNote } from "../src/components/WallOverlay";
import { toChip } from "../src/search";
import type { WallPost } from "../src/mastodon";

const post = (id: string, text: string, tags: string[] = [], media: string[] = []): WallPost => ({
	id,
	url: `https://example.social/@someone/${id}`,
	author: "Someone",
	handle: "someone@example.social",
	avatar: "https://example.social/avatar.png",
	text,
	media,
	tags,
	at: Date.parse("2026-10-18T09:00:00Z"),
	repliesCount: 2,
	favouritesCount: 7,
	reblogsCount: 1,
});

// A chip beginning `#!` asks the fediverse; everything else asks the vault.
assert.strictEqual(WALL_PREFIX, "!");
assert.strictEqual(wallTag(toChip("#!tea")!), "tea");
assert.strictEqual(wallTag(toChip("#!Tea")!), "tea", "a tag is a tag whatever its case");
assert.strictEqual(wallTag(toChip("#tea")!), null, "a plain tag is the vault's");
assert.strictEqual(wallTag(toChip("tea")!), null);
assert.strictEqual(wallTagOf([toChip("cup")!, toChip("#!tea")!]), "tea");
assert.strictEqual(wallTagOf([toChip("#tea")!]), null);
assert.strictEqual(wallTagOf([]), null);

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
assert.ok(note.includes("mastodon_id: 9"), note);
assert.ok(note.includes("image: https://example.social/p.jpg"), note);
assert.ok(note.includes("  - wall"), note);
assert.ok(note.includes("  - tea"), note);
assert.ok(note.includes("a pot of oolong"), note);
assert.ok(note.includes("author: \"@someone@example.social\""), note);
