import * as assert from "node:assert";
import { type App, TFile } from "obsidian";
import { VaultIndex } from "../src/index";
import { strayPictures } from "../src/sync";
import { DEFAULT_SETTINGS, type SkyboxSettings } from "../src/types";

/**
 * The index over a vault that is only a few objects. Enough of Obsidian to
 * answer what a card shows, which is the one thing under test here: a note
 * that embeds a picture should show it, wherever the picture sits in the
 * vault, and whatever else the note's properties offer.
 */
function vaultOf(files: { path: string; text?: string; embeds?: string[]; front?: Record<string, unknown> }[]) {
	const made = files.map((entry) => {
		const file = new TFile() as TFile & { stat: { mtime: number; ctime: number; size: number } };
		const name = entry.path.split("/").pop() ?? entry.path;
		const dot = name.lastIndexOf(".");
		Object.assign(file, {
			path: entry.path,
			name,
			basename: dot > 0 ? name.slice(0, dot) : name,
			extension: dot > 0 ? name.slice(dot + 1) : "",
			stat: { mtime: 1, ctime: 1, size: 1 },
		});
		return { entry, file };
	});
	const byPath = new Map(made.map(({ entry, file }) => [entry.path, file]));
	/** A file arriving after the index was built, as a download does. */
	const add = (entry: { path: string; text?: string; embeds?: string[] }) => {
		const file = new TFile() as TFile;
		const name = entry.path.split("/").pop() ?? entry.path;
		const dot = name.lastIndexOf(".");
		Object.assign(file, {
			path: entry.path,
			name,
			basename: dot > 0 ? name.slice(0, dot) : name,
			extension: dot > 0 ? name.slice(dot + 1) : "",
			stat: { mtime: 2, ctime: 2, size: 1 },
		});
		made.push({ entry, file });
		byPath.set(entry.path, file);
		return file;
	};
	const app = {
		vault: {
			getFiles: () => made.map(({ file }) => file),
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
			getResourcePath: (file: TFile) => `app://local/${file.path}`,
			cachedRead: async (file: TFile) =>
				made.find(({ file: other }) => other === file)?.entry.text ?? "",
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const found = made.find(({ file: other }) => other === file);
				if (!found) return null;
				return {
					frontmatter: found.entry.front,
					embeds: (found.entry.embeds ?? []).map((link) => ({ link })),
					headings: [],
					tags: [],
				};
			},
			// Obsidian resolves a bare name against the whole vault, which is
			// how an attachment in the root is found from a note in a folder,
			// and a size or an alias on the end is not part of the name.
			getFirstLinkpathDest: (link: string) => {
				const path = link.split("#")[0].split("|")[0].trim();
				return (
					byPath.get(path) ??
					made.find(({ file }) => file.name === path.split("/").pop())?.file ??
					null
				);
			},
		},
	} as unknown as App;
	return { app, byPath, add };
}

const settings = (over: Partial<SkyboxSettings> = {}): SkyboxSettings => ({
	...DEFAULT_SETTINGS,
	...over,
});

// A bookmark note that embeds a picture Obsidian wrote to the vault root, which
// is what dropping one on the editor of an open card leaves behind.
{
	const { app } = vaultOf([
		{
			path: "bookmarks/A page.md",
			text: "# A page\n\n![[blue065.gif]]",
			embeds: ["blue065.gif"],
			front: { title: "A page", tags: ["bookmark"] },
		},
		{ path: "blue065.gif" },
	]);
	const index = new VaultIndex(app, settings());
	index.build();
	const item = index.get("bookmarks/A page.md");
	assert.strictEqual(item?.preview, "app://local/blue065.gif", "the picture it embeds");
	assert.strictEqual(item?.previewOffered, false, "nothing offered it; the note holds it");
	assert.strictEqual(
		index.get("blue065.gif")?.embedded,
		true,
		"and the picture belongs to that note rather than standing as its own card"
	);
}

// The line before the bytes, which is the order a dropped address arrives in
// when whoever fetches it writes the note first. The card cannot draw a
// picture that is not there yet, and it must draw it the moment it is.
{
	const { app, add } = vaultOf([
		{ path: "bookmarks/A page.md", text: "![[later.gif]]", embeds: ["later.gif|300"] },
	]);
	const index = new VaultIndex(app, settings());
	index.build();
	assert.strictEqual(index.get("bookmarks/A page.md")?.preview, null, "nothing resolves yet");

	const picture = add({ path: "later.gif" });
	index.onCreate(picture);
	assert.strictEqual(
		index.get("bookmarks/A page.md")?.preview,
		"app://local/later.gif",
		"the note was waiting on that name, so it is read again"
	);
	assert.strictEqual(
		index.get("later.gif")?.embedded,
		true,
		"and the picture joins the note rather than standing beside it"
	);
}

// A picture the page offered, and a picture the note holds. The index reports
// which is which, so the card can prefer the one somebody put there.
{
	const { app } = vaultOf([
		{
			path: "bookmarks/B page.md",
			front: { image: "https://host/offered.jpg" },
		},
	]);
	const index = new VaultIndex(app, settings());
	index.build();
	const item = index.get("bookmarks/B page.md");
	assert.strictEqual(item?.preview, "https://host/offered.jpg");
	assert.strictEqual(item?.previewOffered, true);
}

// Preview images off means nothing is loaded from anywhere.
{
	const { app } = vaultOf([
		{ path: "bookmarks/C page.md", front: { image: "https://host/offered.jpg" } },
	]);
	const index = new VaultIndex(app, settings({ bookmarkImages: false }));
	index.build();
	assert.strictEqual(index.get("bookmarks/C page.md")?.preview, null);
}

// A cover picked by hand wins, and it can be an address as well as a file.
{
	const { app } = vaultOf([
		{
			path: "notes/D.md",
			front: { cover: "[[pictures/mine.png]]", image: "https://host/offered.jpg" },
			embeds: ["pictures/other.png"],
		},
		{ path: "pictures/mine.png" },
		{ path: "pictures/other.png" },
	]);
	const index = new VaultIndex(app, settings());
	index.build();
	const item = index.get("notes/D.md");
	assert.strictEqual(item?.preview, "app://local/pictures/mine.png");
	assert.strictEqual(item?.previewOffered, false);
}
{
	const { app } = vaultOf([
		{ path: "notes/E.md", front: { cover: "https://host/pinned.gif" } },
	]);
	const index = new VaultIndex(app, settings());
	index.build();
	assert.strictEqual(index.get("notes/E.md")?.preview, "https://host/pinned.gif");
}

// What the hub asks the index: every picture the notes it serves hold, so the
// ones it cannot send with them can be counted. A picture pasted on a phone
// lands wherever Obsidian keeps attachments, which is the vault root until
// somebody changes it, and the note arrives on the other device without it.
{
	const { app } = vaultOf([
		{
			path: "bookmarks/A page.md",
			embeds: ["pasted.png", "skybox/kept.png"],
		},
		{ path: "elsewhere/B note.md", embeds: ["elsewhere/own.png"] },
		{ path: "pasted.png" },
		{ path: "skybox/kept.png" },
		{ path: "elsewhere/own.png" },
	]);
	const index = new VaultIndex(app, settings());
	index.build();

	const served = ["skybox", "bookmarks", "mail"];
	const held = index.pictures((note) => served.some((folder) => note.startsWith(`${folder}/`)));
	assert.deepStrictEqual(
		held.sort(),
		["pasted.png", "skybox/kept.png"],
		"only what the served notes hold, and the folder it sits in is not the question yet"
	);
	assert.deepStrictEqual(
		strayPictures(held, served),
		["pasted.png"],
		"the one that cannot travel with the note holding it"
	);
}

// A note can hold a track as well as a picture. Both belong to the note rather
// than standing as cards of their own, and only the picture can be drawn on
// one: a note that embeds a track and a picture shows the picture.
{
	const { app } = vaultOf([
		{
			path: "Skybox/a page.md",
			embeds: ["a loop.mp3", "shot.png"],
		},
		{ path: "a loop.mp3" },
		{ path: "shot.png" },
	]);
	const index = new VaultIndex(app, settings());
	index.build();

	assert.strictEqual(
		index.get("Skybox/a page.md")?.preview,
		"app://local/shot.png",
		"the picture it holds, not the track"
	);
	assert.strictEqual(index.get("a loop.mp3")?.kind, "audio");
	assert.strictEqual(index.get("a loop.mp3")?.embedded, true, "it belongs to that note");
	assert.strictEqual(index.get("shot.png")?.embedded, true);
}

// A track kept for its own sake is a card, and knows its own kind.
{
	const { app } = vaultOf([{ path: "music/a track.flac" }, { path: "music/a track.flac.md" }]);
	const index = new VaultIndex(app, settings());
	index.build();
	const item = index.get("music/a track.flac");
	assert.strictEqual(item?.kind, "audio");
	assert.strictEqual(item?.embedded, false);
	assert.strictEqual(item?.sidecar?.path, "music/a track.flac.md", "its tags live beside it");
	assert.strictEqual(index.get("music/a track.flac.md"), undefined, "the sidecar is not a card");
}
