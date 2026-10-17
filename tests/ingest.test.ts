import * as assert from "node:assert";
import { ingest, noteTitle } from "../src/ingest";
import { isWriting } from "../src/writes";
import type { VaultIndex } from "../src/index";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS, type Item, type SkyboxSettings } from "../src/types";

/** The sha256 of the four bytes every image in this file is made of. */
const PNG_HASH = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";

const settings: SkyboxSettings = { ...DEFAULT_SETTINGS, intakeFolder: "" };

const existing = { id: "shots/cat.png", title: "cat.png", kind: "image" } as Item;

const png = () => new File([new Uint8Array([1, 2, 3, 4])], "cat.png", { type: "image/png" });

// Nothing known: the image and its sidecar are written.
{
	const { app, files } = fakeVault();
	const result = await ingest(app, indexWith(), settings, png());
	assert.ok(result?.created);
	assert.strictEqual(result?.duplicate, null);
	assert.strictEqual(result?.path, "cat.png");
	assert.deepStrictEqual([...files.keys()], ["cat.png", "cat.png.md"]);
	assert.match(
		files.get("cat.png.md") as string,
		/^---\ntags: \[\]\nhash: [0-9a-f]{64}\n---\n/,
		"the sidecar carries the hash"
	);
}

// A known hash with nobody to ask: the existing card stands.
{
	const { app, files } = fakeVault();
	const result = await ingest(app, indexWith(existing), settings, png());
	assert.deepStrictEqual(result, { path: existing.id, created: false, duplicate: existing });
	assert.strictEqual(files.size, 0, "nothing is written");
}

// A known hash, and the question is declined.
{
	const { app, files } = fakeVault();
	let asked: Item | null = null;
	const result = await ingest(app, indexWith(existing), settings, png(), async (duplicate) => {
		asked = duplicate;
		return false;
	});
	assert.strictEqual(asked, existing, "the question names the card already holding it");
	assert.deepStrictEqual(result, { path: existing.id, created: false, duplicate: existing });
	assert.strictEqual(files.size, 0, "declining writes nothing");
}

// A known hash, added anyway.
{
	const { app, files } = fakeVault();
	const result = await ingest(app, indexWith(existing), settings, png(), async () => true);
	assert.ok(result?.created, "a second copy is written");
	assert.strictEqual(result?.duplicate, existing, "and it knows what it duplicates");
	assert.deepStrictEqual([...files.keys()], ["cat.png", "cat.png.md"]);
}

// A name already taken gets a numeric suffix.
{
	const { app, files } = fakeVault();
	files.set("cat.png", "earlier");
	const result = await ingest(app, indexWith(), settings, png(), async () => true);
	assert.strictEqual(result?.path, "cat 1.png");
	assert.ok(files.has("cat 1.png.md"));
}

// A markdown note carries its hash in its own frontmatter.
{
	const { app, frontmatter } = fakeVault();
	const note = new File(["# hello\n"], "hello.md", { type: "text/markdown" });
	const result = await ingest(app, indexWith(), { ...settings, intakeFolder: "Inbox" }, note);
	assert.strictEqual(result?.path, "Inbox/hello.md");
	assert.match(String(frontmatter.get("Inbox/hello.md")?.hash), /^[0-9a-f]{64}$/);
}

// Anything that is neither an image nor a note is left alone.
{
	const { app, files } = fakeVault();
	assert.strictEqual(await ingest(app, indexWith(), settings, new File(["x"], "a.zip")), null);
	assert.strictEqual(files.size, 0);
}

// A browser that will not hash still takes the file in, without a hash.
{
	const { app, files } = fakeVault();
	const digest = crypto.subtle.digest;
	const complain = console.error;
	(crypto.subtle as { digest: unknown }).digest = () => {
		throw new Error("no secure context");
	};
	// The failure is the point of this one, so it need not be reported.
	console.error = () => undefined;
	try {
		const result = await ingest(app, indexWith(existing), settings, png(), async () => false);
		assert.ok(result?.created, "the file is still written");
		assert.strictEqual(result?.duplicate, null, "with nothing to compare it against");
		assert.strictEqual(
			files.get("cat.png.md"),
			"---\ntags: []\n---\n\n",
			"and its sidecar carries no hash"
		);
	} finally {
		(crypto.subtle as { digest: unknown }).digest = digest;
		console.error = complain;
	}
}

assert.strictEqual(isWriting(), false, "the write guard comes back down");

/** A vault that remembers what was written to it. */
function fakeVault() {
	const files = new Map<string, unknown>();
	const frontmatter = new Map<string, Record<string, unknown>>();
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => (files.has(path) ? { path } : null),
			createBinary: async (path: string, data: ArrayBuffer) => {
				files.set(path, data);
				return { path };
			},
			create: async (path: string, text: string) => {
				files.set(path, text);
				return { path };
			},
			createFolder: async (path: string) => {
				files.set(path, "folder");
			},
		},
		fileManager: {
			processFrontMatter: async (
				file: { path: string },
				edit: (matter: Record<string, unknown>) => void
			) => {
				const matter = frontmatter.get(file.path) ?? {};
				edit(matter);
				frontmatter.set(file.path, matter);
			},
		},
	} as unknown as App;
	return { app, files, frontmatter };
}

/** An index holding the given card under the test image's hash. */
function indexWith(item?: Item): VaultIndex {
	return {
		hashes: () => (item ? new Map([[PNG_HASH, item]]) : new Map<string, Item>()),
	} as unknown as VaultIndex;
}

// A new note is named after its first line.
assert.strictEqual(noteTitle("# Shopping\n\nmilk"), "Shopping", "heading marks come off");
assert.strictEqual(noteTitle("\n\n  a thought  \nmore"), "a thought", "blank lines are skipped");
assert.strictEqual(noteTitle("- buy milk"), "buy milk", "so do list marks");
assert.strictEqual(
	noteTitle('why/when: "this" <that> #tag'),
	"why when this that tag",
	"anything a filename cannot hold is dropped"
);
assert.strictEqual(noteTitle("   "), "Untitled", "nothing typed still names the note");
assert.strictEqual(noteTitle("x".repeat(90)).length, 60, "a long first line is cut short");
