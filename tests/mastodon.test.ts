import * as assert from "node:assert";
import {
	composePost,
	htmlToText,
	multipartBody,
	normalizeInstance,
	threadTree,
	type MastodonReply,
	readWallPost,
} from "../src/mastodon";
import { hasShareTag } from "../src/sharing";

// An instance is a host however it was typed.
assert.strictEqual(normalizeInstance("mastodon.social"), "https://mastodon.social");
assert.strictEqual(normalizeInstance("https://mastodon.social/"), "https://mastodon.social");
assert.strictEqual(normalizeInstance("  https://a.b//  "), "https://a.b");
assert.strictEqual(normalizeInstance(""), "");

// The link survives whole, whatever else has to go.
const long = "x".repeat(600);
const post = composePost({ title: "A note", link: "https://example.com/a", body: long }, 500);
assert.ok(post.length <= 500, String(post.length));
assert.ok(post.endsWith("https://example.com/a"), post);
assert.ok(post.startsWith("A note"), post);
assert.ok(post.includes("…"), "the body is cut, not the link");

// A short note goes out whole, title and words and link.
const small = composePost({ title: "Soup", link: "https://example.com/s", body: "It was good." }, 500);
assert.strictEqual(small, "Soup\n\nIt was good.\n\nhttps://example.com/s");

// A title that is also the body is not said twice.
assert.strictEqual(composePost({ title: "Soup", body: "Soup" }, 500), "Soup");

// No link, no trailing blank lines.
assert.strictEqual(composePost({ title: "Soup", body: "" }, 500), "Soup");

// An instance with a smaller limit is honoured.
const tight = composePost({ title: "A note", link: "https://e.com/a", body: "x".repeat(80) }, 60);
assert.ok(tight.length <= 60, String(tight.length));
assert.ok(tight.endsWith("https://e.com/a"), tight);

// Status content is the server's HTML; a vault wants words.
assert.strictEqual(htmlToText("<p>Hello <b>there</b></p><p>Again</p>"), "Hello there\n\nAgain");
assert.strictEqual(htmlToText("one<br>two"), "one\ntwo");
assert.strictEqual(htmlToText("a &amp; b &#39;c&#39;"), "a & b 'c'");
assert.strictEqual(htmlToText(""), "");

// The multipart envelope: fields first, then the file, then the closing line.
const bytes = new TextEncoder().encode("IMG").buffer;
const body = multipartBody("B", { description: "alt" }, { name: "a.png", type: "image/png", bytes });
const text = new TextDecoder().decode(body);
assert.ok(text.startsWith('--B\r\nContent-Disposition: form-data; name="description"'), text.slice(0, 60));
assert.ok(text.includes('name="file"; filename="a.png"'), text);
assert.ok(text.includes("Content-Type: image/png"), text);
assert.ok(text.includes("\r\nIMG\r\n--B--\r\n"), text);

// The tag is matched whatever case it was written in, and never when empty.
assert.ok(hasShareTag(["share"], "share"));
assert.ok(hasShareTag(["Share", "cooking"], "share"));
assert.ok(!hasShareTag(["sharing"], "share"));
assert.ok(!hasShareTag([], "share"));
assert.ok(!hasShareTag(["share"], ""));

// A thread is a tree: each reply says what it answers, and the client puts
// them back together.
const reply = (id: string, inReplyTo: string | null, at = ""): MastodonReply => ({
	id,
	accountId: "me",
	author: id,
	handle: id,
	avatar: "",
	text: id,
	url: "",
	at,
	favouritesCount: 0,
	inReplyTo,
});

const tree = threadTree(
	[reply("a", "root"), reply("b", "a"), reply("c", "root"), reply("d", "b")],
	"root"
);
assert.deepStrictEqual(
	tree.map((node) => node.reply.id),
	["a", "c"],
	"replies to the post itself are the top of the thread"
);
assert.deepStrictEqual(tree[0].children.map((node) => node.reply.id), ["b"]);
assert.deepStrictEqual(tree[0].children[0].children.map((node) => node.reply.id), ["d"]);
assert.strictEqual(tree[1].children.length, 0);

// A reply whose parent is missing from the context still shows up.
const orphaned = threadTree([reply("x", "gone")], "root");
assert.deepStrictEqual(orphaned.map((node) => node.reply.id), ["x"]);

// A reply that somehow answers itself does not become its own child.
const looped = threadTree([reply("y", "y")], "root");
assert.deepStrictEqual(looped.map((node) => node.reply.id), ["y"]);
assert.strictEqual(looped[0].children.length, 0);

assert.deepStrictEqual(threadTree([], "root"), []);

// The top of a thread reads newest first; a branch reads forwards.
const ordered = threadTree(
	[
		reply("old", "root", "2026-10-01T10:00:00Z"),
		reply("new", "root", "2026-10-05T10:00:00Z"),
		reply("answer", "old", "2026-10-02T10:00:00Z"),
		reply("later", "old", "2026-10-03T10:00:00Z"),
	],
	"root"
);
assert.deepStrictEqual(
	ordered.map((node) => node.reply.id),
	["new", "old"],
	"the newest reply to the post is at the top"
);
assert.deepStrictEqual(
	ordered[1].children.map((node) => node.reply.id),
	["answer", "later"],
	"inside a branch the order is as it happened"
);

// A boost on a timeline is a status wrapping somebody else's. What goes on the
// wall is the post that was written, said to have been passed on by whoever
// boosted it, and the next page counts the boost rather than the post.
const boosted = readWallPost({
	id: "99",
	created_at: "2026-10-18T09:00:00Z",
	account: { id: "b1", acct: "passer@example.social", display_name: "Passer" },
	content: "",
	reblog: {
		id: "12",
		url: "https://example.social/@writer/12",
		created_at: "2026-10-17T09:00:00Z",
		content: "<p>a pot of oolong</p>",
		account: { id: "w1", acct: "writer@example.social", display_name: "Writer" },
		reblogs_count: 3,
		reblogged: true,
		tags: [{ name: "tea" }],
	},
});
assert.strictEqual(boosted.id, "12", "the post is the one that was written");
assert.strictEqual(boosted.text, "a pot of oolong");
assert.strictEqual(boosted.handle, "writer@example.social");
assert.strictEqual(boosted.accountId, "w1", "following follows the author, not the booster");
assert.strictEqual(boosted.boostedBy, "passer@example.social");
assert.strictEqual(boosted.entryId, "99", "paging counts timeline entries");
assert.strictEqual(boosted.boosted, true);
assert.strictEqual(boosted.reblogsCount, 3);
assert.deepStrictEqual(boosted.tags, ["tea"]);

// A plain post is its own entry, boosted by nobody.
const plain = readWallPost({
	id: "12",
	content: "<p>tea</p>",
	account: { id: "w1", acct: "writer@example.social" },
});
assert.strictEqual(plain.entryId, "12");
assert.strictEqual(plain.boostedBy, "");
assert.strictEqual(plain.boosted, false);
