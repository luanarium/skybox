/**
 * Which picture a note's card shows.
 *
 * A note that embeds an image has one already, and the first one is almost
 * always the one the note is about, so that becomes the card's cover and the
 * drawn gradient steps aside. A note that would rather show a different one
 * says so in a `cover` property, which the metadata box writes when you pick
 * from the images the note holds.
 *
 * The order is: the cover you chose, then a picture written into the note's
 * own text, then a picture the page offered for its own social cards, then the
 * first thing the note embeds. Nothing at all means cover art.
 *
 * A picture in the text comes above an offered one because somebody put it
 * there, while the offered one was read off the page and may be a logo. Only
 * the text above the extracted article counts: the pictures inside an article
 * arrived with it, nobody chose them, and the page's own offering is a better
 * guess than the first thing its layout happened to hold.
 */

import { ARTICLE_HEADING } from "./article";
import { isImageExtension } from "./types";

/** Only a web address is worth putting in an `img`, and only as itself. */
export function webImage(value: unknown): string | null {
	return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

/**
 * The file a `cover` property points at, however it was written: `[[a.png]]`,
 * `![[a.png]]`, `"a.png"`, or a path with a heading or alias on the end. A web
 * address is not a file and comes back as nothing, since `webImage` has it.
 */
export function coverTarget(value: unknown): string | null {
	if (typeof value !== "string") return null;
	let text = value.trim().replace(/^!/, "");
	if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2);
	// `[[file|alias]]` and `[[file#heading]]` both point at the file.
	text = text.split("|")[0].split("#")[0].trim();
	text = text.replace(/^["']|["']$/g, "").trim();
	if (!text || webImage(text)) return null;
	return text;
}

/** How a chosen cover is written into frontmatter: a link the vault can follow. */
export function coverLink(path: string): string {
	return `[[${path}]]`;
}

/** Whether two cover values point at the same file. */
export function sameCover(value: unknown, path: string): boolean {
	const target = coverTarget(value);
	if (!target) return false;
	return target === path || path.endsWith(`/${target}`) || target === path.split("/").pop();
}

/**
 * The first picture written into a note's own text, as it was written: a vault
 * path from `![[a.png]]` or `![](a.png)`, or a web address from `![](http...)`.
 * Frontmatter, fenced code and the extracted article are not the note's own
 * text and are left out of the search.
 */
export function bodyImage(text: string): string | null {
	const own = ownText(text);
	let found: string | null = null;
	let at = own.length;
	for (const pattern of [EMBEDDED, INLINE]) {
		const match = pattern.exec(own);
		if (!match || match.index >= at) continue;
		// The inline form captures twice: angle brackets, or a bare path.
		const reference = picture(match[1] ?? match[2]);
		if (!reference) continue;
		found = reference;
		at = match.index;
	}
	return found;
}

/** `![[a.png]]`, with any alias or heading after the name dropped. */
const EMBEDDED = /!\[\[([^\]\n|#]+)(?:[|#][^\]\n]*)?\]\]/;

/** `![alt](a.png "title")`, with the angle brackets a spaced path needs. */
const INLINE = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^()\s\n]+))[^)\n]*\)/;

/**
 * A reference worth drawing. An address is taken on trust, since plenty serve
 * a picture without saying so in the path; a path in the vault has to look
 * like an image, or a linked note would be asked to draw itself.
 */
function picture(reference: string | undefined): string | null {
	const text = (reference ?? "").trim();
	if (!text) return null;
	if (webImage(text)) return text;
	const extension = text.split("?")[0].split("#")[0].split(".").pop() ?? "";
	return isImageExtension(extension) ? text : null;
}

/** The part of a note somebody wrote themselves. */
function ownText(text: string): string {
	let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
	const article = new RegExp(`^${ARTICLE_HEADING}[ \\t]*$`, "m").exec(body);
	if (article) body = body.slice(0, article.index);
	return body.replace(/^(```|~~~)[\s\S]*?^\1[ \t]*$/gm, "");
}
