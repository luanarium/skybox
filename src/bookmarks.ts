import { type App, Notice, Platform, TFile, requestUrl } from "obsidian";
import { hasMeta, parseMetadata } from "./metadata";
import { ensureFolder, noteTitle, uniquePath } from "./ingest";
import type { SkyboxSettings } from "./types";
import { guarded } from "./writes";

/**
 * Bookmarks, taken from the browser rather than from a browser extension.
 *
 * Chromium keeps its bookmarks in one JSON file that it rewrites whenever you
 * add or move one, so bookmarking stays what it always was and the vault picks
 * them up afterwards. Brave's own sync is end-to-end encrypted between Brave
 * installs with nothing for a third party to hook, and `chrome.bookmarks`
 * belongs to extensions, so the file is the only route that needs no server
 * and no extension.
 *
 * Reading it means Node's `fs` and a path outside the vault, which is the
 * second place this plugin steps outside Obsidian's API and the browser, and
 * a larger step than the first. So it is off until it is turned on, the path
 * is shown and editable rather than discovered silently, nothing is ever read
 * but that one file, and the whole thing is desktop-only: on a phone the
 * import does not exist.
 *
 * It is one way and additive. A bookmark deleted in the browser leaves its
 * note alone, because curating happens in the vault, where searching and
 * reading are better than any browser's bookmark manager.
 */

export interface Bookmark {
	title: string;
	url: string;
	/** Milliseconds since the Unix epoch. */
	added: number;
	/** The browser folders it sits in, outermost first. */
	folders: string[];
}

interface Node {
	type?: string;
	name?: string;
	url?: string;
	date_added?: string;
	children?: Node[];
}

/** Chromium counts microseconds from 1601; everything else counts from 1970. */
const EPOCH_OFFSET_MS = 11644473600000;

export function chromiumTime(value: string | undefined): number {
	const micros = Number(value ?? 0);
	if (!Number.isFinite(micros) || micros <= 0) return 0;
	return Math.round(micros / 1000 - EPOCH_OFFSET_MS);
}

/** The roots a Chromium bookmarks file has, in the order they are offered. */
const ROOTS = ["bookmark_bar", "other", "synced"];

/**
 * Every bookmark in the file, with the folder path that led to it. Anything
 * that is not an ordinary web page is left out: `javascript:` bookmarklets,
 * `chrome://` pages and the like have nothing to show in a grid.
 */
export function parseBookmarks(json: string): Bookmark[] {
	let parsed: { roots?: Record<string, Node> };
	try {
		parsed = JSON.parse(json) as { roots?: Record<string, Node> };
	} catch {
		return [];
	}
	const found: Bookmark[] = [];
	const seen = new Set<string>();

	const walk = (node: Node, folders: string[]): void => {
		for (const child of node.children ?? []) {
			if (child.type === "folder" || Array.isArray(child.children)) {
				walk(child, child.name ? [...folders, child.name] : folders);
				continue;
			}
			const url = child.url ?? "";
			if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
			seen.add(url);
			found.push({
				title: (child.name ?? "").trim() || hostOf(url),
				url,
				added: chromiumTime(child.date_added),
				folders,
			});
		}
	};

	for (const root of ROOTS) {
		const node = parsed.roots?.[root];
		if (node) walk(node, []);
	}
	return found;
}

export function hostOf(url: string): string {
	const match = /^https?:\/\/([^/?#]+)/i.exec(url);
	return match ? match[1].replace(/^www\./i, "") : url;
}

/** A browser folder name as a tag: no spaces, no hashes, nothing empty. */
export function folderTag(name: string): string | null {
	const tag = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9/_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return tag || null;
}

/**
 * The keys a note about a web page carries here are the ones Obsidian's own
 * Web Clipper writes: `title`, `source`, `created`, `tags`, with `author`,
 * `published` and `description` joining them when there is something to put
 * in them. Matching the clipper means a bookmark note and a clipped page look
 * the same to everything downstream: a Dataview query, an auto-tagger, a
 * template, or a person reading properties in the sidebar.
 *
 * The `bookmark` tag plays the part `clippings` plays for the clipper: one
 * handle for every note that came in this way.
 */
export const BOOKMARK_TAG = "bookmark";

export function bookmarkNote(bookmark: Bookmark): string {
	const tags = [BOOKMARK_TAG];
	for (const folder of bookmark.folders) {
		const tag = folderTag(folder);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	const created = bookmark.added
		? new Date(bookmark.added).toISOString().slice(0, 10)
		: new Date().toISOString().slice(0, 10);
	const lines = [
		"---",
		`title: ${yaml(bookmark.title)}`,
		`source: ${bookmark.url}`,
		`created: ${created}`,
		"tags:",
	];
	for (const tag of tags) lines.push(`  - ${tag}`);
	lines.push("---", "", `# ${bookmark.title}`, "", `<${bookmark.url}>`, "");
	return lines.join("\n");
}

/** A title can hold anything; YAML cannot. Quote it when it has to be. */
export function yaml(value: string): string {
	return /^[\w][\w ,.'()/-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

interface FileSystem {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: string): string;
	statSync(path: string): { mtimeMs: number };
	readdirSync(path: string): string[];
}

/**
 * Node's `fs`, on desktop, or nothing. Obsidian hands `require` to the
 * renderer on desktop and not on a phone, which is the feature detection.
 */
function fs(): FileSystem | null {
	if (!Platform.isDesktopApp) return null;
	const host = window as unknown as { require?: (id: string) => unknown };
	try {
		return (host.require?.("fs") as FileSystem) ?? null;
	} catch (error) {
		console.error("Skybox: no filesystem for bookmarks", error);
		return null;
	}
}

function home(): string {
	const host = window as unknown as {
		require?: (id: string) => unknown;
		process?: { env?: Record<string, string | undefined> };
	};
	try {
		const os = host.require?.("os") as { homedir(): string } | undefined;
		const dir = os?.homedir();
		if (dir) return dir;
	} catch {
		// Fall through to the environment.
	}
	const env = host.process?.env ?? {};
	return env.HOME ?? env.USERPROFILE ?? "";
}

/** `~/…` is a shell's idea, not a path: it gets expanded here. */
export function expandHome(path: string, homedir: string): string {
	if (path === "~") return homedir;
	return path.startsWith("~/") ? `${homedir}/${path.slice(2)}` : path;
}

/**
 * Where Chromium browsers keep bookmarks, per browser and per profile. The
 * Flatpak and Snap paths are here because that is how browsers arrive on
 * Linux now, and the one this was written against is a Flatpak Brave.
 */
const BROWSER_DIRS = [
	".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser",
	".config/BraveSoftware/Brave-Browser",
	"snap/brave/current/.config/BraveSoftware/Brave-Browser",
	".config/google-chrome",
	".config/chromium",
	".config/microsoft-edge",
	".config/vivaldi",
	"Library/Application Support/BraveSoftware/Brave-Browser",
	"Library/Application Support/Google/Chrome",
	"AppData/Local/BraveSoftware/Brave-Browser/User Data",
	"AppData/Local/Google/Chrome/User Data",
];

const PROFILES = ["Default", "Profile 1", "Profile 2", "Profile 3"];

/** Bookmarks files this machine actually has, for the settings to offer. */
export function findBookmarkFiles(): string[] {
	const node = fs();
	const homedir = home();
	if (!node || !homedir) return [];
	const found: string[] = [];
	for (const dir of BROWSER_DIRS) {
		for (const profile of PROFILES) {
			const path = `${homedir}/${dir}/${profile}/Bookmarks`;
			try {
				if (node.existsSync(path)) found.push(path);
			} catch {
				// An unreadable directory is simply not a candidate.
			}
		}
	}
	return found;
}

export class BookmarkImport {
	/** The modification time last imported, so an unchanged file is skipped. */
	private seenAt = 0;
	/** Why the last look failed, for the notice to say something useful. */
	private trouble: string | null = null;

	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {}

	/** Whether this build can read bookmarks at all. */
	static available(): boolean {
		return fs() !== null;
	}

	/**
	 * Reads the file and writes a note for every bookmark the vault has not
	 * got. Returns how many were written, or null when it could not look.
	 */
	async sync(force = false): Promise<number | null> {
		// Asking for it is asking for it: the switch governs the looking that
		// happens on its own, not the button that says to look now.
		if (!force && !this.settings.bookmarksEnabled) return null;
		const node = fs();
		const path = expandHome(this.settings.bookmarksPath.trim(), home());
		this.trouble = null;
		if (!node) {
			this.trouble = "this build has no access to the filesystem";
			return null;
		}
		if (!path) {
			this.trouble = "no bookmarks file is set";
			return null;
		}

		let json: string;
		try {
			const stat = node.statSync(path);
			// Chromium rewrites the file on every change; its mtime is the cue.
			if (!force && stat.mtimeMs <= this.seenAt) return 0;
			this.seenAt = stat.mtimeMs;
			json = node.readFileSync(path, "utf8");
		} catch (error) {
			// The path it actually tried, which is the thing worth knowing when
			// `~` went unexpanded or a profile is named something else.
			this.trouble = `${path}: ${error instanceof Error ? error.message : String(error)}`;
			console.error("Skybox: could not read the bookmarks file", error);
			return null;
		}

		const bookmarks = parseBookmarks(json);
		if (bookmarks.length === 0) {
			await this.enrich();
			return 0;
		}

		const already = this.importedUrls();
		const folder = await ensureFolder(this.app, this.settings.bookmarksFolder);
		let written = 0;
		for (const bookmark of bookmarks) {
			if (already.has(bookmark.url)) continue;
			already.add(bookmark.url);
			const target = await uniquePath(this.app, folder, `${noteTitle(bookmark.title)}.md`);
			try {
				await guarded(() => this.app.vault.create(target, bookmarkNote(bookmark)));
				written++;
			} catch (error) {
				console.error("Skybox: could not write a bookmark note", error);
			}
		}
		await this.enrich();
		return written;
	}

	/**
	 * What a page says about itself, written into the notes that have not
	 * asked yet. A bookmark is a title and a link until this runs; afterwards
	 * it carries the page's own description, author, date and preview image,
	 * which is what makes a card look like the thing it points at.
	 *
	 * A handful at a time, because the first import of a long-kept bookmarks
	 * file would otherwise fetch hundreds of pages at once. The rest are
	 * picked up by later passes, and `fetched` marks the ones that have been
	 * asked, so a page with nothing to say is not asked again.
	 */
	private async enrich(limit = 8): Promise<void> {
		if (!this.settings.bookmarksFetch) return;
		let budget = limit;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (budget <= 0) return;
			const front = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (front?.fetched) continue;
			const source = this.sourceOf(file, front);
			if (!source) continue;
			budget--;
			await this.describe(file, source);
		}
	}

	/**
	 * The page a note is about, when the note is one of this plugin's. A page
	 * clipped by something else is that tool's business and may already hold
	 * more than this could, so the `bookmark` tag is what marks ours.
	 *
	 * Imports written before the properties matched the Web Clipper's used a
	 * `url` key and no tag. Those are recognised by living in the bookmarks
	 * folder, and `describe` brings them up to date as it goes.
	 */
	private sourceOf(file: TFile, front: Record<string, unknown> | undefined): string | null {
		const web = (value: unknown): string | null =>
			typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;

		const tags = front?.tags;
		const tagged = Array.isArray(tags)
			? tags.includes(BOOKMARK_TAG)
			: typeof tags === "string" && tags.split(/[,\s]+/).includes(BOOKMARK_TAG);
		if (tagged) return web(front?.source) ?? web(front?.url);

		const folder = this.settings.bookmarksFolder.trim().replace(/^\/+|\/+$/g, "");
		const inFolder = folder ? file.path.startsWith(`${folder}/`) : !file.path.includes("/");
		return inFolder ? web(front?.url) : null;
	}

	/** One page, asked once, and what it said written down. */
	private async describe(file: TFile, source: string): Promise<void> {
		const today = new Date().toISOString().slice(0, 10);
		let html = "";
		try {
			const response = await requestUrl({ url: source, throw: false });
			const type = response.headers?.["content-type"] ?? response.headers?.["Content-Type"] ?? "";
			if (response.status < 400 && /html/i.test(type)) html = response.text;
		} catch (error) {
			console.error("Skybox: could not read", source, error);
		}

		const meta = html ? parseMetadata(html, source) : null;
		await guarded(async () => {
			await this.app.fileManager.processFrontMatter(file, (front) => {
				// Asked and answered, even when the answer was nothing: the
				// page does not get asked again on every sync.
				front.fetched = today;
				// An older import, brought up to the shape the clipper uses.
				if (!front.source && typeof front.url === "string") {
					front.source = front.url;
					delete front.url;
				}
				if (typeof front.added === "string" && !front.created) {
					front.created = front.added;
					delete front.added;
				}
				const tags: unknown = front.tags;
				if (Array.isArray(tags)) {
					if (!tags.includes(BOOKMARK_TAG)) tags.unshift(BOOKMARK_TAG);
				} else if (!tags) {
					front.tags = [BOOKMARK_TAG];
				}
				if (!meta || !hasMeta(meta)) return;
				if (meta.description && !front.description) front.description = meta.description;
				if (meta.author && !front.author) front.author = meta.author;
				if (meta.published && !front.published) front.published = meta.published;
				if (meta.image && !front.image) front.image = meta.image;
				if (meta.site && !front.site) front.site = meta.site;
			});
			// The description also goes in the body, where a card's excerpt
			// comes from: a bookmark should read as more than its own URL.
			if (meta?.description) {
				await this.app.vault.process(file, (text) =>
					text.includes(meta.description as string) ? text : `${text.trimEnd()}\n\n${meta.description}\n`
				);
			}
		});
	}

	/**
	 * Every URL the vault already holds a note for, read from frontmatter
	 * through the metadata cache, so nothing is read off disk twice and a note
	 * moved out of the bookmarks folder still counts as imported. A page
	 * clipped with Obsidian's Web Clipper counts too, since it writes the same
	 * `source` key: the same page does not arrive twice by two routes.
	 */
	private importedUrls(): Set<string> {
		const urls = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const front = this.app.metadataCache.getFileCache(file)?.frontmatter;
			// `source` is what the clipper writes and what this writes now;
			// `url` is what earlier imports wrote, and still counts.
			for (const key of ["source", "url"]) {
				const value = front?.[key];
				if (typeof value === "string" && value) urls.add(value.trim());
			}
		}
		return urls;
	}

	/** Says what happened, for the button in the settings. */
	async syncAloud(): Promise<void> {
		const written = await this.sync(true);
		if (written === null) {
			new Notice(
				`Skybox could not read the bookmarks file. ${this.trouble ?? "No reason given."}`,
				10000
			);
			return;
		}
		new Notice(
			written === 0
				? "No new bookmarks."
				: `${written} bookmark${written === 1 ? "" : "s"} added.`
		);
	}
}
