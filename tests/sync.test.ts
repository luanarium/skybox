import * as assert from "node:assert";
import {
	hubComplaint,
	megabytes,
	strayComplaint,
	strayPictures,
	tooHeavy,
	hubFolders,
	hubUrl,
	normalizePhrase,
	phraseKey,
	pullPlan,
	reviewSentence,
	syncSentence,
	sameKey,
	servedFolders,
	withinServed,
	type HubEntry,
	type PullPlan,
	type SyncTally,
	type PushStep,
} from "../src/sync";

// A phrase typed on two keyboards differs in case and spacing, and neither
// difference is one anybody meant.
assert.strictEqual(normalizePhrase("  Two  Blue   Herons "), "two blue herons");
assert.strictEqual(normalizePhrase("\t\n"), "");

// The same phrase gives the same key on both devices, a different one does
// not, and no phrase is no key at all.
const key = await phraseKey("Two blue herons");
assert.strictEqual(key, await phraseKey("  two   BLUE herons  "));
assert.notStrictEqual(key, await phraseKey("two blue heron"));
assert.strictEqual(key.length, 64, "a sha-256, as hex");
assert.strictEqual(await phraseKey("   "), "");

// Keys are compared whole, and nothing compares equal to nothing.
assert.ok(sameKey(key, key));
assert.ok(!sameKey(key, key.slice(0, 63) + "0"));
assert.ok(!sameKey("", ""));
assert.ok(!sameKey(key, key.slice(0, 32)));

// Folders are a list, blank lines and comments aside.
assert.deepStrictEqual(servedFolders("Skybox\n\n  bookmarks/ \n# later\n/mail"), [
	"Skybox",
	"bookmarks",
	"mail",
]);

// Nothing named means the folders Skybox writes to itself.
assert.deepStrictEqual(
	hubFolders({ hubFolders: "", intakeFolder: "Skybox", bookmarksFolder: "bookmarks", mailFolder: "mail" }),
	["Skybox", "bookmarks", "mail"]
);
assert.deepStrictEqual(
	hubFolders({ hubFolders: "notes", intakeFolder: "Skybox", bookmarksFolder: "", mailFolder: "" }),
	["notes"],
	"what you named wins"
);

// A hub serving nothing is the one broken state that looks healthy from the
// other device, so it is said out loud rather than discovered.
assert.match(hubComplaint([], []), /^Serving nothing: no folders are named/);
assert.strictEqual(
	hubComplaint(["Skybox"], []),
	'Serving nothing: "Skybox" is not in this vault.'
);
assert.strictEqual(
	hubComplaint(["bookmarks", "mail"], []),
	'Serving nothing: "bookmarks", "mail" are not in this vault.'
);
assert.strictEqual(
	hubComplaint(["Skybox", "mail"], ["Skybox"]),
	'"mail" is not in this vault, so nothing comes from it.'
);
assert.strictEqual(hubComplaint(["Skybox"], ["Skybox"]), "", "nothing to say");

// The other way a sync can look healthy and leave a hole: the note travels and
// the picture inside it does not, because Obsidian keeps attachments wherever
// its own setting says, which is the vault root until somebody changes it.
const served = ["Skybox", "bookmarks"];
assert.deepStrictEqual(
	strayPictures(["Skybox/a.png", "blue065.gif", "attachments/b.png", "blue065.gif"], served),
	["attachments/b.png", "blue065.gif"],
	"what the notes point at from outside, once each"
);
assert.deepStrictEqual(strayPictures(["Skybox/a.png"], served), []);
assert.strictEqual(strayComplaint([]), "", "nothing to say");
const remedy =
	"Obsidian's own setting for where new attachments go decides that folder, " +
	"under Files and links.";
assert.strictEqual(
	strayComplaint(["blue065.gif"]),
	"One picture these notes hold is outside the served folders, in the vault root, " +
		`so the note arrives without it. ${remedy}`
);
assert.strictEqual(
	strayComplaint(["blue065.gif", "attachments/b.png", "attachments/c.png"]),
	"3 pictures these notes hold are outside the served folders, in the vault root " +
		`and "attachments", so those notes arrive without them. ${remedy}`
);
assert.match(
	strayComplaint(["a.png", "x/b.png", "y/c.png", "z/d.png"]),
	/in the vault root, "x" and 2 more,/,
	"the places, not all of them"
);

// What leaves the vault is checked on the way out as well as the way in.
assert.ok(withinServed("Skybox/a note.md", served));
assert.ok(withinServed("bookmarks/page.md", served));
assert.ok(withinServed("Skybox", served), "the folder itself is in it");
assert.ok(!withinServed("elsewhere/secret.md", served), "a folder nobody named");
assert.ok(!withinServed("Skybox/../../etc/passwd", served), "no walking up");
assert.ok(!withinServed("/etc/passwd", served), "no absolute paths");
assert.ok(!withinServed("C:/Windows/win.ini", served), "no drives");
assert.ok(!withinServed("http://elsewhere/x", served), "no addresses");
assert.ok(!withinServed("Skyboxed/other.md", served), "a prefix is not a folder");
assert.ok(!withinServed("", served));
assert.ok(!withinServed("Skybox/a.md", []), "serving nothing serves nothing");
assert.ok(
	!withinServed(".obsidian/plugins/skybox/hub-state.json", [".obsidian"]),
	"the configuration is never served, whatever is named"
);

// The plan: what to take, what to leave, and what is ours to offer later.
const entry = (path: string, hash: string): HubEntry => ({ path, hash, size: 1, mtime: 1 });

const plan = pullPlan(
	new Map([
		["Skybox/same.md", "aaa"],
		["Skybox/untouched.md", "bbb"],
		["Skybox/mine.md", "mine"],
		["Skybox/both.md", "mine too"],
		["Skybox/only here.md", "ccc"],
	]),
	[
		entry("Skybox/same.md", "aaa"),
		entry("Skybox/untouched.md", "newer"),
		entry("Skybox/mine.md", "bbb"),
		entry("Skybox/both.md", "theirs"),
		entry("Skybox/new there.md", "ddd"),
	],
	new Map([
		["Skybox/same.md", "aaa"],
		["Skybox/untouched.md", "bbb"],
		["Skybox/mine.md", "bbb"],
		["Skybox/both.md", "agreed"],
	])
);

assert.deepStrictEqual(
	plan.fetch.map((step) => [step.path, step.why]),
	[
		["Skybox/untouched.md", "changed"],
		["Skybox/new there.md", "new"],
	],
	"a file nobody here has touched is safe to replace; a file nobody here has is new"
);
assert.deepStrictEqual(
	plan.collided,
	[{ path: "Skybox/both.md", base: "agreed", mine: "mine too", theirs: "theirs" }],
	"both hashes and the one they started from, which is what a merge needs"
);
assert.deepStrictEqual(
	plan.ours.map((step) => [step.path, step.why, step.base ?? null]).sort(),
	[
		["Skybox/mine.md", "changed", "bbb"],
		["Skybox/only here.md", "new", null],
	],
	"a change the hub does not have goes up with the hash it last agreed to"
);

// A file the two sides agreed on and the hub no longer lists was deleted
// there. Untouched here, it is offered for review rather than removed, and
// nothing in the plan removes anything on its own.
const gone = pullPlan(
	new Map([["Skybox/old.md", "aaa"]]),
	[],
	new Map([["Skybox/old.md", "aaa"]])
);
assert.deepStrictEqual(gone.fetch, []);
assert.deepStrictEqual(gone.ours, [], "an untouched file the hub dropped is not ours to offer");
assert.deepStrictEqual(gone.gone, [{ path: "Skybox/old.md", base: "aaa" }]);
assert.deepStrictEqual(gone.forget, [], "the baseline is needed until somebody answers");

// Deleted on the hub and edited here: the edit is what survives, and the
// disagreement is reported rather than resolved.
const goneEdited = pullPlan(
	new Map([["Skybox/old.md", "mine"]]),
	[],
	new Map([["Skybox/old.md", "aaa"]])
);
assert.deepStrictEqual(goneEdited.gone, [], "nothing is offered for deletion");
assert.deepStrictEqual(goneEdited.collided, [{ path: "Skybox/old.md", base: "aaa", mine: "mine" }]);

// Deleted here and untouched on the hub: the hub is asked, not told.
const deletedHere = pullPlan(new Map(), [entry("Skybox/old.md", "aaa")], new Map([["Skybox/old.md", "aaa"]]));
assert.deepStrictEqual(deletedHere.fetch, [], "what was deleted here does not come back");
assert.deepStrictEqual(deletedHere.sendGone, [{ path: "Skybox/old.md", base: "aaa" }]);

// Deleted here and edited on the hub: the edit survives there, and this is a
// disagreement rather than a deletion to carry.
const deletedHereEdited = pullPlan(
	new Map(),
	[entry("Skybox/old.md", "theirs")],
	new Map([["Skybox/old.md", "aaa"]])
);
assert.deepStrictEqual(deletedHereEdited.sendGone, []);
assert.deepStrictEqual(deletedHereEdited.fetch, [], "it is not fetched back either");
assert.deepStrictEqual(deletedHereEdited.collided, [
	{ path: "Skybox/old.md", base: "aaa", theirs: "theirs" },
]);

// Gone from both sides: the baseline has nothing left to describe, and
// keeping it would make the file new all over again if it ever returned.
const bothGone = pullPlan(new Map(), [], new Map([["Skybox/old.md", "aaa"]]));
assert.deepStrictEqual(bothGone.forget, ["Skybox/old.md"]);
assert.deepStrictEqual(bothGone.gone, []);
assert.deepStrictEqual(bothGone.sendGone, []);

// What it says afterwards, in both directions.
const nothing: PushStep[] = [];
const empty: PullPlan = { fetch: [], collided: [], ours: [], gone: [], sendGone: [], forget: [] };
const nil: SyncTally = {
	taken: 0,
	sent: 0,
	asked: 0,
	merged: 0,
	split: 0,
	trouble: 0,
	stray: 0,
	heavy: 0,
};
assert.strictEqual(
	syncSentence({ ...empty, ours: nothing }, { ...nil }),
	"Already synced."
);
assert.strictEqual(
	syncSentence(
		{ ...empty, ours: [{ path: "a", hash: "x", why: "new" }] },
		{ ...nil, sent: 1 }
	),
	"Sent one file."
);
assert.strictEqual(
	syncSentence(
		{
			...empty,
			fetch: [{ path: "a", hash: "x", why: "new" }],
			collided: [{ path: "b", base: "z", mine: "y", theirs: "x" }],
			ours: [{ path: "c", hash: "y", why: "changed", base: "z" }],
		},
		{ ...nil, taken: 1 }
	),
	"Took one file, 1 changed on both sides, left alone, 1 the hub would not take.",
	"a refused push is said out loud rather than swallowed"
);
assert.strictEqual(
	syncSentence({ ...empty, ours: nothing }, { ...nil, taken: 2, sent: 3, trouble: 1 }),
	"Took 2 files, sent 3 files, 1 would not come across."
);

// A picture that cannot travel with the note holding it is said either way,
// because the note arrives looking broken and nothing else mentions it.
assert.strictEqual(
	syncSentence({ ...empty, ours: nothing }, { ...nil, stray: 1 }),
	"Already synced, but one picture stayed behind, outside the served folders."
);
assert.strictEqual(
	syncSentence(
		{ ...empty, ours: [{ path: "a", hash: "x", why: "new" }] },
		{ ...nil, sent: 1, stray: 2 }
	),
	"Sent one file, 2 pictures stayed behind, outside the served folders."
);

assert.strictEqual(
	syncSentence(
		{ ...empty, collided: [{ path: "a" }, { path: "b" }, { path: "c" }] },
		{ ...nil, merged: 1, split: 1 }
	),
	"Merged one file, split one file in two, 1 changed on both sides, left alone.",
	"what it managed and what is still somebody's to decide"
);

// And what a review says once somebody has read it.
assert.strictEqual(reviewSentence(0, 0), "Nothing to remove.");
assert.strictEqual(reviewSentence(1, 0), "One file to the trash.");
assert.strictEqual(reviewSentence(2, 1), "2 files to the trash, kept 1.");
assert.strictEqual(reviewSentence(0, 3), "Kept 3.");

// An address, however it was typed.
assert.strictEqual(hubUrl("10.0.0.71", 8777, "/manifest"), "http://10.0.0.71:8777/manifest");
assert.strictEqual(hubUrl("10.0.0.71:9000", 8777, "/file"), "http://10.0.0.71:9000/file");
assert.strictEqual(
	hubUrl("http://neohp.tailaa2ab0.ts.net:8777/", 8777, "/skybox"),
	"http://neohp.tailaa2ab0.ts.net:8777/skybox"
);
assert.strictEqual(
	hubUrl("https://neohp.tailaa2ab0.ts.net", 8777, "/skybox"),
	"https://neohp.tailaa2ab0.ts.net/skybox",
	"a name with a certificate keeps its own port"
);
assert.strictEqual(hubUrl("  ", 8777, "/manifest"), "");

// A file crosses whole, through memory on both sides, so the size decides
// whether it can cross at all. The limit is read off the manifest rather than
// discovered by stalling.
const sizes = new Map([
	["Skybox/a note.md", 2_000],
	["Skybox/a track.mp3", 102_483_310],
	["Skybox/a photo.png", 4 * 1024 * 1024],
]);
const asked = ["Skybox/a note.md", "Skybox/a track.mp3", "Skybox/a photo.png"];
assert.deepStrictEqual(
	tooHeavy(sizes, asked, 25 * 1024 * 1024),
	["Skybox/a track.mp3"],
	"the track stays where it is; the photo is fine"
);
assert.deepStrictEqual(tooHeavy(sizes, asked, 200 * 1024 * 1024), [], "two computers can take it");
assert.deepStrictEqual(tooHeavy(sizes, asked, 0), [], "no limit set is no limit");
assert.deepStrictEqual(
	tooHeavy(new Map(), asked, 25),
	[],
	"a file whose size nobody said is not assumed to be huge"
);

assert.strictEqual(megabytes(102_483_310), "98 MB");
assert.strictEqual(megabytes(1024 * 1024), "1 MB");
assert.strictEqual(megabytes(1_600_000), "1.5 MB", "small enough to want a decimal");
assert.strictEqual(megabytes(0), "0 MB");

assert.strictEqual(
	syncSentence({ ...empty, ours: nothing }, { ...nil, taken: 1, heavy: 1 }),
	"Took one file, one file too large to carry."
);
assert.strictEqual(
	syncSentence({ ...empty, ours: nothing }, { ...nil, heavy: 2 }),
	"2 files too large to carry."
);
