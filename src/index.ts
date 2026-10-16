import { type App, type TAbstractFile, TFile, getAllTags } from "obsidian";
import {
	type Item,
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

	constructor(private app: App) {}

	build(): void {
		this.items.clear();
		const files = this.app.vault.getFiles();
		for (const file of files) this.add(file);
		this.notify();
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
			return;
		}
		if (isImageExtension(file.extension)) {
			this.items.set(file.path, this.imageItem(file));
		}
	}

	private noteItem(file: TFile): Item {
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
		};
	}

	private imageItem(file: TFile): Item {
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPathFor(file.path));
		const sidecar = sidecarFile instanceof TFile ? sidecarFile : null;
		const cache = sidecar ? this.app.metadataCache.getFileCache(sidecar) : null;
		return {
			id: file.path,
			kind: "image",
			file,
			sidecar,
			title: this.titleOf(file, cache?.frontmatter?.title),
			mtime: Math.max(file.stat.mtime, sidecar?.stat.mtime ?? 0),
			tags: tagNames(cache ? getAllTags(cache) : null),
			headings: [],
			excerpt: "",
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

function tagNames(tags: string[] | null): string[] {
	if (!tags) return [];
	const unique = new Set(tags.map((t) => (t.startsWith("#") ? t.slice(1) : t)));
	return [...unique];
}
