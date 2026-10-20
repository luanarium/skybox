import { isIgnored, parseIgnored } from "./ignore";
import { kindsOf } from "./kinds";
import { coverTarget, webImage } from "./preview";
import { type App, type CachedMetadata, type TAbstractFile, TFile, getAllTags } from "obsidian";
import {
	EMBEDDED_TAG,
	UNREAD_TAG,
	type Item,
	type SkyboxSettings,
	isAudioExtension,
	isImageExtension,
	isMediaExtension,
	sidecarPathFor,
	sidecarTargetPath,
} from "./types";

/**
 * In-memory index of the vault's markdown notes and images, kept current by
 * vault events. Note content is read with `cachedRead` and cached by mtime.
 */
export class VaultIndex {
	private items = new Map<string, Item>();
	private text = new Map<string, { mtime: number; content: string }>();
	private listeners = new Set<() => void>();

	/** Folders to leave alone, parsed from the settings on every build. */
	private ignored: string[] = [];
	/** What each note embeds, and every image some note embeds. */
	private embedsBy = new Map<string, string[]>();
	private embedded = new Set<string>();
	/**
	 * Notes holding a picture that is not in the vault yet, by the name they
	 * are waiting on. A picture dropped from a browser arrives as an address,
	 * and whoever fetches it may write the note's line before the bytes land,
	 * so the embed resolves to nothing at the moment the note is read.
	 */
	private awaited = new Map<string, Set<string>>();

	constructor(
		private app: App,
		private settings: SkyboxSettings,
		/** What has happened to the cards that were shared, and what is unread. */
		private interactions?: { hasUnread(statusId: string): boolean }
	) {}

	build(): void {
		this.items.clear();
		this.embedsBy.clear();
		this.awaited.clear();
		this.ignored = parseIgnored(this.settings.ignoredFolders);
		const files = this.app.vault.getFiles();
		// Embeds first: an image's card says whether a note holds it.
		for (const file of files) {
			if (file.extension === "md") this.embedsBy.set(file.path, this.embedsOf(file));
		}
		this.refreshEmbedded();
		for (const file of files) this.add(file);
		this.notify();
	}

	/**
	 * The pictures and tracks a note embeds, by path. Both are files a note
	 * holds rather than files kept for their own sake, which is what decides
	 * whether they stand as cards; only a picture can be drawn on one.
	 */
	private embedsOf(note: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(note);
		const paths: string[] = [];
		for (const embed of cache?.embeds ?? []) {
			const target = this.app.metadataCache.getFirstLinkpathDest(embed.link, note.path);
			if (target instanceof TFile && isMediaExtension(target.extension)) {
				paths.push(target.path);
				continue;
			}
			// Nothing there to embed, so this note is read again if it
			// turns up: otherwise the card keeps the gradient it drew
			// while the file was missing, and only a restart mends it.
			if (!target) this.awaitPicture(embed.link, note.path);
		}
		return paths;
	}

	/** Remember that this note is waiting on a picture by that name. */
	private awaitPicture(link: string, notePath: string): void {
		const name = (link.split("/").pop() ?? "").split("#")[0].split("|")[0].trim();
		if (!isImageExtension(name.split(".").pop() ?? "")) return;
		const waiting = this.awaited.get(name.toLowerCase()) ?? new Set<string>();
		waiting.add(notePath);
		this.awaited.set(name.toLowerCase(), waiting);
	}

	/**
	 * A picture some note was written around has arrived, so that note is
	 * read again: its card draws the picture, and the picture stops standing
	 * as a card of its own.
	 */
	private picturesArrived(file: TFile): void {
		if (!isImageExtension(file.extension)) return;
		const name = file.name.toLowerCase();
		const waiting = this.awaited.get(name);
		if (!waiting) return;
		this.awaited.delete(name);
		for (const path of waiting) {
			const note = this.app.vault.getAbstractFileByPath(path);
			if (note instanceof TFile && this.items.has(path)) this.index(note);
		}
	}

	private refreshEmbedded(): void {
		this.embedded = new Set<string>();
		for (const paths of this.embedsBy.values()) {
			for (const path of paths) this.embedded.add(path);
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Every card, most recently modified first. */
	all(): Item[] {
		return [...this.items.values()].sort((a, b) => b.mtime - a.mtime);
	}

	/**
	 * Every picture held by the notes this asks about, wherever the picture
	 * itself lives. The hub uses it to find the ones that cannot travel with
	 * the note that holds them.
	 */
	pictures(from: (notePath: string) => boolean): string[] {
		const paths = new Set<string>();
		for (const [note, embeds] of this.embedsBy) {
			if (!from(note)) continue;
			for (const path of embeds) paths.add(path);
		}
		return [...paths];
	}

	/** Every tag in the vault, for the tag box's suggestions. */
	tags(): string[] {
		const all = new Set<string>();
		for (const item of this.items.values()) {
			for (const tag of item.tags) all.add(tag);
		}
		return [...all].sort((a, b) => a.localeCompare(b));
	}

	get(path: string): Item | undefined {
		return this.items.get(path);
	}

	/** The card a file belongs to: a note, an image, or an image's sidecar. */
	itemFor(file: TAbstractFile): Item | undefined {
		if (!(file instanceof TFile)) return undefined;
		const target = sidecarTargetPath(file.path);
		return this.items.get(target ?? file.path);
	}

	/** Text searched for an item: the note's body, or its sidecar's. */
	async content(item: Item): Promise<string> {
		const file = item.kind === "note" ? item.file : item.sidecar;
		if (!file) return "";
		const cached = this.text.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) return cached.content;
		const content = await this.app.vault.cachedRead(file);
		this.text.set(file.path, { mtime: file.stat.mtime, content });
		return content;
	}

	/**
	 * Content hashes written into sidecar frontmatter, read from the cache.
	 * A hash kept by several cards — the reader chose to add a copy anyway —
	 * resolves to the most recently modified of them.
	 */
	hashes(): Map<string, Item> {
		const byHash = new Map<string, Item>();
		for (const item of this.all()) {
			const note = item.kind === "note" ? item.file : item.sidecar;
			if (!note) continue;
			const hash = this.app.metadataCache.getFileCache(note)?.frontmatter?.hash;
			if (typeof hash === "string" && !byHash.has(hash)) byHash.set(hash, item);
		}
		return byHash;
	}

	/** Index a file the plugin has just written and hand back its card. */
	ensure(file: TFile): Item | undefined {
		this.add(file);
		this.notify();
		return this.itemFor(file);
	}

	onCreate(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.add(file);
		this.picturesArrived(file);
		this.notify();
	}

	onModify(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.add(file);
		this.notify();
	}

	onDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		this.text.delete(file.path);
		const target = sidecarTargetPath(file.path);
		if (target) {
			// The image outlives its sidecar.
			const item = this.items.get(target);
			if (item) this.add(item.file);
		} else {
			this.items.delete(file.path);
		}
		this.notify();
	}

	onRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile)) return;
		this.text.delete(oldPath);
		const oldTarget = sidecarTargetPath(oldPath);
		if (oldTarget) {
			const item = this.items.get(oldTarget);
			if (item) this.add(item.file);
		} else {
			this.items.delete(oldPath);
		}
		this.add(file);
		this.picturesArrived(file);
		this.notify();
	}

	/** Index the card a file belongs to, replacing any earlier entry. */
	private add(file: TFile): void {
		// A whole folder at a time: its notes, its images and their sidecars.
		if (isIgnored(file.path, this.ignored)) return;
		const target = sidecarTargetPath(file.path);
		if (target) {
			const image = this.app.vault.getAbstractFileByPath(target);
			if (image instanceof TFile) this.index(image);
			return;
		}
		this.index(file);
	}

	private index(file: TFile): void {
		if (file.extension === "md") {
			// Embeds first: a note's own card shows the first image it holds,
			// and an image's card carries whether anything embeds it. Both
			// read what this note embeds, so it is worked out before either.
			const before = this.embedsBy.get(file.path) ?? [];
			const after = this.embedsOf(file);
			const moved = before.join("\u0000") !== after.join("\u0000");
			if (moved) {
				this.embedsBy.set(file.path, after);
				this.refreshEmbedded();
			}
			this.items.set(file.path, this.noteItem(file));
			if (moved) {
				for (const path of new Set([...before, ...after])) {
					const image = this.app.vault.getAbstractFileByPath(path);
					if (image instanceof TFile && this.items.has(path)) this.index(image);
				}
			}
			return;
		}
		if (isMediaExtension(file.extension)) {
			this.items.set(file.path, this.mediaItem(file));
		}
	}

	private noteItem(file: TFile): Item {
		// A note is never embedded in the sense that matters here: it is read.
		const cache = this.app.metadataCache.getFileCache(file);
		const shown = this.previewOf(file, cache?.frontmatter);
		return {
			id: file.path,
			kind: "note",
			file,
			sidecar: null,
			title: this.titleOf(file, cache?.frontmatter?.title),
			mtime: file.stat.mtime,
			tags: this.noteTags(cache),
			// Worked out from the address, never written into the note.
			kinds: kindsOf(cache?.frontmatter?.source),
			headings: (cache?.headings ?? []).map((h) => h.heading),
			excerpt: "",
			embedded: false,
			preview: shown.picture,
			previewOffered: shown.offered,
			// A conversation says in its own frontmatter what is waiting.
			unread: cache?.frontmatter?.unread === true,
		};
	}

	/** A picture or a track: a file that is its own card, with a sidecar. */
	private mediaItem(file: TFile): Item {
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPathFor(file.path));
		const sidecar = sidecarFile instanceof TFile ? sidecarFile : null;
		const cache = sidecar ? this.app.metadataCache.getFileCache(sidecar) : null;
		const embedded = this.embedded.has(file.path);
		const tags = tagNames(cache ? getAllTags(cache) : null);
		// A tag nobody wrote: it is how the image is found again once hidden,
		// and it falls away the moment the last note stops embedding it.
		if (embedded && !tags.includes(EMBEDDED_TAG)) tags.push(EMBEDDED_TAG);
		return {
			id: file.path,
			kind: isAudioExtension(file.extension) ? "audio" : "image",
			file,
			sidecar,
			title: this.titleOf(file, cache?.frontmatter?.title),
			mtime: Math.max(file.stat.mtime, sidecar?.stat.mtime ?? 0),
			tags,
			kinds: [],
			headings: [],
			excerpt: "",
			embedded,
			preview: null,
			unread: false,
		};
	}

	/**
	 * The picture a note's card shows, and whether it is the page's own
	 * offering: the cover it chose, then a picture fetched for a bookmark,
	 * then the first image it embeds. A note that holds a picture should show
	 * it rather than a drawn one. A picture written into the note's text is
	 * found by the card, which has already read the text for its excerpt, and
	 * it comes above an offered one.
	 */
	private previewOf(
		file: TFile,
		front: Record<string, unknown> | undefined
	): { picture: string | null; offered: boolean } {
		const chosen = coverTarget(front?.cover);
		if (chosen) {
			const target = this.app.metadataCache.getFirstLinkpathDest(chosen, file.path);
			if (target instanceof TFile) {
				return { picture: this.app.vault.getResourcePath(target), offered: false };
			}
		}
		// A cover can be an address as easily as a file, and picking one is a
		// choice, so it stands above anything read off a page.
		const pinned = this.settings.bookmarkImages ? webImage(front?.cover) : null;
		if (pinned) return { picture: pinned, offered: false };
		const remote = this.settings.bookmarkImages ? webImage(front?.image) : null;
		if (remote) return { picture: remote, offered: true };
		const first = this.embedsBy
			.get(file.path)
			?.find((path) => isImageExtension(path.split(".").pop() ?? ""));
		if (!first) return { picture: null, offered: false };
		const embedded = this.app.vault.getAbstractFileByPath(first);
		const picture =
			embedded instanceof TFile ? this.app.vault.getResourcePath(embedded) : null;
		return { picture, offered: false };
	}

	/**
	 * A note's own tags, plus the one a shared card wears while something is
	 * waiting on it. Nothing writes that tag: reading is per device, and a
	 * note is not the place to keep it.
	 */
	private noteTags(cache: CachedMetadata | null): string[] {
		const tags = tagNames(cache ? getAllTags(cache) : null);
		const statusId = cache?.frontmatter?.mastodon_id;
		if (statusId && this.interactions?.hasUnread(String(statusId)) && !tags.includes(UNREAD_TAG)) {
			tags.push(UNREAD_TAG);
		}
		return tags;
	}

	private titleOf(file: TFile, fromFrontmatter: unknown): string {
		if (typeof fromFrontmatter === "string" && fromFrontmatter.trim()) {
			return fromFrontmatter.trim();
		}
		return file.extension === "md" ? file.basename : file.name;
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function tagNames(tags: string[] | null): string[] {
	if (!tags) return [];
	const unique = new Set(tags.map((t) => (t.startsWith("#") ? t.slice(1) : t)));
	return [...unique];
}
