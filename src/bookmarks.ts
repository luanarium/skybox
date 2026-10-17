import { type App, Notice, Platform } from "obsidian";
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

/** The note a bookmark becomes. */
export function bookmarkNote(bookmark: Bookmark): string {
	const tags = bookmark.folders.map(folderTag).filter((tag): tag is string => tag !== null);
	const added = bookmark.added
		? new Date(bookmark.added).toISOString().slice(0, 10)
		: new Date().toISOString().slice(0, 10);
	const lines = ["---", `url: ${bookmark.url}`, `added: ${added}`];
	if (tags.length > 0) {
		lines.push("tags:");
		for (const tag of tags) lines.push(`  - ${tag}`);
	}
	lines.push("---", "", `# ${bookmark.title}`, "", `<${bookmark.url}>`, "");
	return lines.join("\n");
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
		if (bookmarks.length === 0) return 0;

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
		return written;
	}

	/**
	 * Every URL the vault already holds a note for, read from frontmatter
	 * through the metadata cache, so nothing is read off disk twice and a note
	 * moved out of the bookmarks folder still counts as imported.
	 */
	private importedUrls(): Set<string> {
		const urls = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const url = this.app.metadataCache.getFileCache(file)?.frontmatter?.url;
			if (typeof url === "string" && url) urls.add(url.trim());
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
