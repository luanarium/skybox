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
	/**
	 * What the bookmarked address is for: `video`, `music`, `code`. Worked
	 * out from the address, never written into the note, and asked for with
	 * a chip rather than matched as a word.
	 */
	kinds: string[];
	headings: string[];
	/** Plain excerpt for notes; empty for images. */
	excerpt: string;
	/** Some note embeds this image, so it is part of that note's page. */
	embedded: boolean;
	/** A picture the card can show instead of cover art, from `image`. */
	preview: string | null;
	/**
	 * The preview is the picture the page offered for its own social cards,
	 * rather than one this note holds, so a picture written into the note
	 * itself is the better one to draw.
	 */
	previewOffered?: boolean;
	/** A conversation with something in it nobody has read. */
	unread: boolean;
	/**
	 * Where this card came from, when it came from the fediverse rather than
	 * the vault. Anything that would touch a file checks this first.
	 */
	remote?: import("./mastodon").WallPost;
}

export interface SkyboxSettings {
	/** Folder new and added files are written to; empty means the vault root. */
	intakeFolder: string;
	openOnStartup: boolean;
	standalone: boolean;
	/** Expand a shared item straight into its editor instead of staying on the grid. */
	expandOnShare: boolean;
	/** Put the cursor in the note as it opens, rather than waiting for a click. */
	focusEditor: boolean;
	/** Columns on a phone: from the screen's width, or a number you pick. */
	mobileColumns: "auto" | "1" | "2";
	/** Light or dark for the pane alone, or whatever Obsidian is wearing. */
	theme: "follow" | "dark" | "light";
	/** Draw a cover for cards that have no picture of their own. */
	coverArt: boolean;
	/** Name a new note after its first line, once the typing settles. */
	nameFromFirstLine: boolean;
	/** Folders the grid leaves alone, one per line. */
	ignoredFolders: string;
	/** Keep images that notes embed out of the grid until something is searched. */
	hideEmbedded: boolean;
	/** Read the browser's bookmarks file and write a note for each one. */
	bookmarksEnabled: boolean;
	/** The Chromium bookmarks file to read; `~` is expanded. */
	bookmarksPath: string;
	/** Where bookmark notes are written. */
	bookmarksFolder: string;
	/** Show the picture a bookmarked page offers, where it offers one. */
	bookmarkImages: boolean;
	/** Keep the article itself in the note, not only what the page says of it. */
	bookmarkArticle: boolean;
	/** Play a bookmarked video in its card, rather than linking out to it. */
	videoEmbeds: boolean;
	/** Read the top comments under a bookmarked video, which asks YouTube. */
	videoComments: boolean;
	/** The Mastodon instance to post to; empty means sharing is off. */
	mastodonInstance: string;
	/** The tag that means "share this", without its hash. */
	mastodonTag: string;
	/** How a shared post is addressed. */
	mastodonVisibility: string;
	/** Serve this vault's Skybox folders to your other devices. Desktop only. */
	hubServe: boolean;
	/** The port the hub listens on, and the one a puller assumes. */
	hubPort: number;
	/** The hub this device pulls from, as an address, with or without a port. */
	hubAddress: string;
	/** Pull when the pane opens, when the app comes forward, and on a timer. */
	hubAuto: boolean;
	/** Folders the hub serves, one per line. Empty means Skybox's own. */
	hubFolders: string;
	/** Whether this hub takes changes from the devices that pull from it. */
	hubAccept: boolean;
	/** The Maildir to read mail from; empty means mail is off. */
	mailMaildir: string;
	/** Where a reply is left for the mail transfer agent to send. */
	mailOutbox: string;
	/** Where thread notes are written. */
	mailFolder: string;
	/** Your own address, for telling your messages from theirs. */
	mailAddress: string;
	/** Bring Mastodon's direct messages in as threads as well. */
	dmEnabled: boolean;
}

export const DEFAULT_SETTINGS: SkyboxSettings = {
	intakeFolder: "",
	openOnStartup: true,
	standalone: false,
	expandOnShare: false,
	focusEditor: false,
	// A phone in the hand reads better as two columns than as one.
	mobileColumns: "2",
	theme: "follow",
	coverArt: true,
	nameFromFirstLine: true,
	ignoredFolders: "",
	hideEmbedded: true,
	bookmarksEnabled: false,
	bookmarksPath: "",
	bookmarksFolder: "bookmarks",
	bookmarkImages: true,
	bookmarkArticle: true,
	videoEmbeds: true,
	videoComments: true,
	mastodonInstance: "",
	mastodonTag: "share",
	mastodonVisibility: "unlisted",
	mailMaildir: "",
	mailOutbox: "",
	mailFolder: "mail",
	mailAddress: "",
	dmEnabled: false,
	hubServe: false,
	hubPort: 8777,
	hubAddress: "",
	hubAuto: true,
	hubFolders: "",
	hubAccept: true,
};

/** The tag an image gets for being embedded in a note; nothing writes it. */
export const EMBEDDED_TAG = "embedded";

/**
 * What a sync tags the second copy of a note with, when the same note was
 * edited on two devices in the same lines and there was no merging the two.
 * Searching `#collision` is then the whole of finding them.
 */
export const COLLISION_TAG = "collision";

/** The tag that says a video is something to put on rather than to watch. */
export const MUSIC_TAG = "music";

/** The tag a shared card wears while something is waiting; nothing writes it. */
export const UNREAD_TAG = "comments";

export const VIEW_TYPE_SKYBOX = "skybox-search-view";

/**
 * Obsidian defines its colours on `.theme-dark` and `.theme-light`, so putting
 * one of those classes on the pane dresses it independently of the app.
 */
export function themeClass(settings: SkyboxSettings): string | null {
	if (settings.theme === "dark") return "theme-dark";
	if (settings.theme === "light") return "theme-light";
	return null;
}

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
