import type { TFile } from "obsidian";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"];

export type ItemKind = "note" | "image";

/** One card in the grid: a markdown note, or an image plus its sidecar note. */
export interface Item {
	/** Path of the primary file; stable identity of the card. */
	id: string;
	kind: ItemKind;
	/** The note, or the image. */
	file: TFile;
	/** Sidecar note holding an image's tags and thoughts, when one exists. */
	sidecar: TFile | null;
	title: string;
	mtime: number;
	tags: string[];
	headings: string[];
	/** Plain excerpt for notes; empty for images. */
	excerpt: string;
}

export interface TelegridSettings {
	/** Folder new and added files are written to; empty means the vault root. */
	intakeFolder: string;
	openOnStartup: boolean;
	standalone: boolean;
	/** Expand a shared item straight into its editor instead of staying on the grid. */
	expandOnShare: boolean;
	/** Put the cursor in the note as it opens, rather than waiting for a click. */
	focusEditor: boolean;
}

export const DEFAULT_SETTINGS: TelegridSettings = {
	intakeFolder: "",
	openOnStartup: true,
	standalone: false,
	expandOnShare: false,
	focusEditor: false,
};

export const VIEW_TYPE_TELEGRID = "telegrid-search-view";

export function isImageExtension(ext: string): boolean {
	return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}

/** `foo.png.md` is the sidecar of `foo.png`. */
export function sidecarTargetPath(notePath: string): string | null {
	if (!notePath.endsWith(".md")) return null;
	const stem = notePath.slice(0, -3);
	const dot = stem.lastIndexOf(".");
	if (dot <= stem.lastIndexOf("/") + 1) return null;
	return isImageExtension(stem.slice(dot + 1)) ? stem : null;
}

export function sidecarPathFor(imagePath: string): string {
	return `${imagePath}.md`;
}
