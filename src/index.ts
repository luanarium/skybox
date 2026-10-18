import { isIgnored, parseIgnored } from "./ignore";
import { type App, type TAbstractFile, TFile, getAllTags } from "obsidian";
import {
	EMBEDDED_TAG,
	type Item,
	type SkyboxSettings,
	isImageExtension,
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

	constructor(
		private app: App,
		private settings: SkyboxSettings
	) {}

	build(): void {
		this.items.clear();
		this.embedsBy.clear();
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

	/** The images a note embeds, by path. */
	private embedsOf(note: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(note);
		const paths: string[] = [];
		for (const embed of cache?.embeds ?? []) {
			const target = this.app.metadataCache.getFirstLinkpathDest(embed.link, note.path);
			if (target instanceof TFile && isImageExtension(target.extension)) {
				paths.push(target.path);
			}
		}
		return paths;
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
			this.items.set(file.path, this.noteItem(file));
			// What this note embeds may have just changed, and an image's card
			// carries whether anything embeds it.
			const before = this.embedsBy.get(file.path) ?? [];
			const after = this.embedsOf(file);
			if (before.join("\u0000") !== after.join("\u0000")) {
				this.embedsBy.set(file.path, after);
				this.refreshEmbedded();
				for (const path of new Set([...before, ...after])) {
					const image = this.app.vault.getAbstractFileByPath(path);
					if (image instanceof TFile && this.items.has(path)) this.index(image);
				}
			}
			return;
		}
		if (isImageExtension(file.extension)) {
			this.items.set(file.path, this.imageItem(file));
		}
	}

	private noteItem(file: TFile): Item {
		// A note is never embedded in the sense that matters here: it is read.
		const cache = this.app.metadataCache.getFileCache(file);
		return {
			id: file.path,
			kind: "note",
			file,
			sidecar: null,
			title: this.titleOf(file, cache?.frontmatter?.title),
			mtime: file.stat.mtime,
			tags: tagNames(cache ? getAllTags(cache) : null),
			headings: (cache?.headings ?? []).map((h) => h.heading),
			excerpt: "",
			embedded: false,
			// A bookmark that has been out and looked at its page has one.
			preview: this.settings.bookmarkImages ? webImage(cache?.frontmatter?.image) : null,
		};
	}

	private imageItem(file: TFile): Item {
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
			kind: "image",
			file,
			sidecar,
			title: this.titleOf(file, cache?.frontmatter?.title),
			mtime: Math.max(file.stat.mtime, sidecar?.stat.mtime ?? 0),
			tags,
			headings: [],
			excerpt: "",
			embedded,
			preview: null,
		};
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

/** Only a web address is worth putting in an `img`, and only as itself. */
function webImage(value: unknown): string | null {
	return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function tagNames(tags: string[] | null): string[] {
	if (!tags) return [];
	const unique = new Set(tags.map((t) => (t.startsWith("#") ? t.slice(1) : t)));
	return [...unique];
}
