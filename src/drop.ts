/**
 * What a drag is carrying, and where a dropped picture goes.
 *
 * A file dragged from a file manager arrives as a `File` and goes straight
 * through intake. A picture dragged off a web page carries no file at all:
 * the browser hands over the address it came from, in `text/uri-list` or in a
 * scrap of HTML holding the `img` tag. Reading those is what this file is for,
 * so a drag from a page is not silently nothing.
 *
 * The decisions are here, as plain functions over strings, and the fetching
 * and writing stay in `App.tsx`.
 */

import { ARTICLE_HEADING } from "./article";
import { isImageExtension } from "./types";

/** The three flavours of a drag worth reading, as the browser hands them over. */
export interface Dragged {
	uriList: string;
	html: string;
	text: string;
}

/** What each picture type is called once it is a file in the vault. */
const PICTURE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/svg+xml": "svg",
};

/**
 * The address a drag is pointing at. `text/uri-list` is the one browsers agree
 * on; the HTML scrap is read next because dragging a picture out of a page
 * carries the whole `img` tag, which says where the picture is even when the
 * link around it says somewhere else; plain text is read last, and only when
 * the whole of it is one address.
 */
export function draggedPicture(carried: Dragged): string | null {
	for (const line of carried.uriList.split(/\r?\n/)) {
		const address = line.trim();
		// A `uri-list` comment is a comment, not an address.
		if (!address || address.startsWith("#")) continue;
		if (isAddress(address)) return address;
	}
	const tag = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(carried.html);
	const source = entities((tag?.[1] ?? tag?.[2] ?? tag?.[3] ?? "").trim());
	if (isAddress(source)) return source;
	const text = carried.text.trim();
	if (isAddress(text) && !/\s/.test(text)) return text;
	return null;
}

function isAddress(value: string): boolean {
	return /^https?:\/\/\S+$/i.test(value);
}

/** An `src` is HTML, so `&amp;` in it is an ampersand. */
function entities(value: string): string {
	return value
		.replace(/&amp;/gi, "&")
		.replace(/&#38;/g, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'");
}

/** Which kind of picture a host says it is sending, if it is a picture at all. */
export function pictureExtension(contentType: string): string | null {
	const type = contentType.split(";")[0].trim().toLowerCase();
	return PICTURE_TYPES[type] ?? null;
}

/**
 * What to call a picture pulled off the web: the name it has in its address
 * where it has one, since that is the name the page gave it, and the kind of
 * picture the host said it was sending where the address is only a number or a
 * query. Anything a filename cannot hold becomes a space, as everywhere else
 * files are named here.
 */
export function pictureName(address: string, extension: string): string {
	// The host is not part of the picture's name, so the address loses its head.
	const path = address.replace(/^[a-z]+:\/\/[^/]*/i, "").split(/[?#]/)[0];
	const last = path.split("/").filter(Boolean).pop() ?? "";
	let name = last;
	try {
		name = decodeURIComponent(last);
	} catch {
		// A half-written escape in an address is not worth refusing a picture.
	}
	const dot = name.lastIndexOf(".");
	const had = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	const stem = clean(isImageExtension(had) ? name.slice(0, dot) : name);
	return `${stem || "picture"}.${isImageExtension(had) ? had : extension}`;
}

function clean(stem: string): string {
	return stem
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60)
		.trim();
}

/**
 * Where a picture dropped on a note goes: into the part somebody wrote
 * themselves, which means above an extracted article rather than after it.
 * That is the part a reader is looking at, and the part a card reads for its
 * picture.
 */
export function placePicture(text: string, markup: string): string {
	const article = new RegExp(`^${ARTICLE_HEADING}[ \\t]*$`, "m").exec(text);
	if (article) {
		const before = text.slice(0, article.index).replace(/\s*$/, "");
		return `${before}\n\n${markup}\n\n${text.slice(article.index)}`;
	}
	const body = text.replace(/\s*$/, "");
	return body ? `${body}\n\n${markup}\n` : `${markup}\n`;
}

/** How a picture already in the vault is written into a note. */
export function pictureLink(path: string): string {
	return `![[${path}]]`;
}
