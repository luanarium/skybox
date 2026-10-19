import * as assert from "node:assert";
import {
	hubFolders,
	hubUrl,
	normalizePhrase,
	phraseKey,
	pullPlan,
	pullSentence,
	sameKey,
	servedFolders,
	withinServed,
	type HubEntry,
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

// What leaves the vault is checked on the way out as well as the way in.
const served = ["Skybox", "bookmarks"];
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
assert.deepStrictEqual(plan.collided, ["Skybox/both.md"], "changed on both sides, left alone");
assert.deepStrictEqual(plan.ours.sort(), ["Skybox/mine.md", "Skybox/only here.md"]);

// A file the two sides agreed on and the hub no longer lists was deleted
// there, and a deletion is not something this slice carries either way.
const gone = pullPlan(
	new Map([["Skybox/old.md", "aaa"]]),
	[],
	new Map([["Skybox/old.md", "aaa"]])
);
assert.deepStrictEqual(gone.fetch, []);
assert.deepStrictEqual(gone.ours, [], "an untouched file the hub dropped is not ours to offer");

// A file deleted here that the hub still has is not fetched again, since
// deleting it was somebody's decision.
const deletedHere = pullPlan(new Map(), [entry("Skybox/old.md", "aaa")], new Map([["Skybox/old.md", "aaa"]]));
assert.deepStrictEqual(deletedHere.fetch, [], "what was deleted here stays deleted");

// What it says afterwards.
assert.strictEqual(
	pullSentence({ fetch: [], collided: [], ours: [] }, 0, 0),
	"Already in step."
);
assert.strictEqual(
	pullSentence({ fetch: [], collided: [], ours: ["a", "b"] }, 0, 0),
	"Nothing to take. 2 here the hub has not got."
);
assert.strictEqual(
	pullSentence({ fetch: [{ path: "a", hash: "x", why: "new" }], collided: ["b"], ours: [] }, 1, 0),
	"Took one file, 1 changed on both sides, left alone."
);
assert.strictEqual(
	pullSentence({ fetch: [], collided: [], ours: [] }, 2, 1),
	"Took 2 files, and 1 would not come across."
);

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
