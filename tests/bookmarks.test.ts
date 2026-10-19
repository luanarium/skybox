import * as assert from "node:assert";
import {
	BOOKMARK_TAG,
	bookmarkNote,
	chromiumTime,
	expandHome,
	flatpakGrant,
	folderTag,
	hostOf,
	parseBookmarks,
	yaml,
} from "../src/bookmarks";

/** The shape Chromium writes, cut down: roots, folders, nested folders. */
const FILE = JSON.stringify({
	version: 1,
	roots: {
		bookmark_bar: {
			type: "folder",
			name: "Bookmarks bar",
			children: [
				{
					type: "url",
					name: "About Terminology",
					url: "https://www.enlightenment.org/about-terminology",
					date_added: "13432716970845803",
				},
				{
					type: "folder",
					name: "Linux tools",
					children: [
						{
							type: "folder",
							name: "Terminals",
							children: [
								{
									type: "url",
									name: "mastui",
									url: "https://github.com/kimusan/mastui",
									date_added: "13432717675427489",
								},
							],
						},
					],
				},
				{ type: "url", name: "a bookmarklet", url: "javascript:void(0)", date_added: "0" },
				{ type: "url", name: "settings", url: "chrome://settings", date_added: "0" },
			],
		},
		other: {
			type: "folder",
			name: "Other bookmarks",
			children: [
				{ type: "url", name: "", url: "https://www.example.com/path", date_added: "0" },
				// The same page bookmarked twice is one card's worth.
				{
					type: "url",
					name: "again",
					url: "https://github.com/kimusan/mastui",
					date_added: "13432717675427489",
				},
			],
		},
		sync_transaction_version: "1",
	},
});

const found = parseBookmarks(FILE);

assert.deepStrictEqual(
	found.map((b) => b.url),
	[
		"https://www.enlightenment.org/about-terminology",
		"https://github.com/kimusan/mastui",
		"https://www.example.com/path",
	],
	"web pages only, each one once, in the order the roots are read"
);

// The folder path comes with it, outermost first, roots left out.
assert.deepStrictEqual(found[1].folders, ["Linux tools", "Terminals"]);
assert.deepStrictEqual(found[0].folders, []);

// A bookmark with no name falls back to its host.
assert.strictEqual(found[2].title, "example.com");
assert.strictEqual(hostOf("https://www.example.com/path"), "example.com");
assert.strictEqual(hostOf("not a url"), "not a url");

// Chromium counts microseconds from 1601.
assert.strictEqual(new Date(chromiumTime("13432716970845803")).getUTCFullYear(), 2026);
assert.strictEqual(chromiumTime("0"), 0);
assert.strictEqual(chromiumTime(undefined), 0);
assert.strictEqual(chromiumTime("nonsense"), 0);

// A file that is not a bookmarks file is no bookmarks, not a crash.
assert.deepStrictEqual(parseBookmarks("{"), []);
assert.deepStrictEqual(parseBookmarks("{}"), []);
assert.deepStrictEqual(parseBookmarks('{"roots":{}}'), []);

// Folder names become tags a vault can hold.
assert.strictEqual(folderTag("Linux tools"), "linux-tools");
assert.strictEqual(folderTag("  Reading / later "), "reading-/-later");
assert.strictEqual(folderTag("###"), null);
assert.strictEqual(folderTag(""), null);

// The properties are the ones Obsidian's own Web Clipper writes, so a
// bookmark note and a clipped page look alike to everything downstream.
const note = bookmarkNote(found[1]);
assert.ok(note.startsWith("---\ntitle: mastui\nsource: https://github.com/kimusan/mastui\n"), note);
assert.ok(/\ncreated: \d{4}-\d{2}-\d{2}\n/.test(note), note);
assert.ok(note.includes(`\n  - ${BOOKMARK_TAG}\n`), note);
assert.ok(note.includes("\n  - linux-tools\n"), note);
assert.ok(note.includes("\n  - terminals\n"), note);
assert.ok(note.includes("# mastui"), note);
assert.ok(note.includes("<https://github.com/kimusan/mastui>"), note);

// Every bookmark gets the one handle, folders or no folders.
const plain = bookmarkNote(found[0]);
assert.ok(plain.includes(`tags:\n  - ${BOOKMARK_TAG}\n`), plain);

// A title YAML cannot hold plainly gets quoted.
assert.strictEqual(yaml("mastui"), "mastui");
assert.strictEqual(yaml("Chicken soup - Wikipedia"), "Chicken soup - Wikipedia");
assert.strictEqual(yaml("Shadow of the Colossus: the quest"), '"Shadow of the Colossus: the quest"');
assert.strictEqual(yaml('He said "no"'), '"He said \\"no\\""');
assert.strictEqual(yaml("#tagged"), '"#tagged"');
assert.ok(bookmarkNote({ ...found[0], title: "a: b" }).includes('title: "a: b"'));

// `~` is a shell's idea of home, not a path.
assert.strictEqual(expandHome("~/x/Bookmarks", "/home/neo"), "/home/neo/x/Bookmarks");
assert.strictEqual(expandHome("~", "/home/neo"), "/home/neo");
assert.strictEqual(expandHome("/tmp/Bookmarks", "/home/neo"), "/tmp/Bookmarks");
assert.strictEqual(expandHome("~notuser/x", "/home/neo"), "~notuser/x");

// The grant a Flatpak Obsidian needs to read a Flatpak browser, worked out
// from the path itself, so the line offered is the line to run.
assert.strictEqual(
	flatpakGrant(
		"/home/neo/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/Default/Bookmarks"
	),
	"flatpak override --user --filesystem=~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser:ro md.obsidian.Obsidian"
);
assert.strictEqual(
	flatpakGrant("~/.var/app/com.google.Chrome/config/google-chrome/Profile 1/Bookmarks"),
	"flatpak override --user --filesystem=~/.var/app/com.google.Chrome/config/google-chrome:ro md.obsidian.Obsidian"
);
// Nothing typed yet: Brave stands as the example, since that is the common one.
assert.ok(flatpakGrant("").includes("com.brave.Browser"));
assert.ok(flatpakGrant("/home/neo/somewhere/else/Bookmarks").includes("com.brave.Browser"));
