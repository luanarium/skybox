import * as assert from "node:assert";
import { foldNotices, readKept } from "../src/interactions";
import { NOTHING_UNREAD, foldNotice, unreadTotal, type MastodonNotice } from "../src/mastodon";

const notice = (id: string, kind: MastodonNotice["kind"], statusId: string, inReplyTo: string | null = null): MastodonNotice => ({
	id,
	kind,
	statusId,
	inReplyTo,
});

// What came in is counted against the card it belongs to, by kind.
const counted = foldNotices(
	{},
	[
		notice("1", "favourite", "card"),
		notice("2", "mention", "reply-a", "card"),
		notice("3", "reblog", "card"),
		notice("4", "mention", "reply-b", "reply-a"),
	],
	(each) => (each.kind === "favourite" || each.kind === "reblog" ? each.statusId : "card")
);
assert.deepStrictEqual(counted, { card: { replies: 2, favourites: 1, boosts: 1 } });
assert.strictEqual(unreadTotal(counted.card), 4);

// Anything that belongs to no card is left out rather than guessed at.
assert.deepStrictEqual(foldNotices({}, [notice("5", "favourite", "elsewhere")], () => null), {});

// Counts accumulate onto what a card was already holding.
const more = foldNotices(counted, [notice("6", "favourite", "card")], () => "card");
assert.deepStrictEqual(more.card, { replies: 2, favourites: 2, boosts: 1 });
assert.deepStrictEqual(counted.card, { replies: 2, favourites: 1, boosts: 1 }, "the old one is untouched");

// One of each kind, counted where it belongs.
assert.deepStrictEqual(foldNotice(NOTHING_UNREAD, "mention"), { replies: 1, favourites: 0, boosts: 0 });
assert.deepStrictEqual(foldNotice(NOTHING_UNREAD, "favourite"), { replies: 0, favourites: 1, boosts: 0 });
assert.deepStrictEqual(foldNotice(NOTHING_UNREAD, "reblog"), { replies: 0, favourites: 0, boosts: 1 });

// What was kept between sessions, read back, and a store it cannot read is a
// store it starts again rather than a crash.
assert.deepStrictEqual(readKept('{"since":"42","cards":{"a":{"replies":1,"favourites":0,"boosts":0}}}'), {
	since: "42",
	cards: { a: { replies: 1, favourites: 0, boosts: 0 } },
});
assert.deepStrictEqual(readKept(null), { since: "", cards: {} });
assert.deepStrictEqual(readKept("not json"), { since: "", cards: {} });
assert.deepStrictEqual(readKept("{}"), { since: "", cards: {} });
