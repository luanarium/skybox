/**
 * Which picture a note's card shows.
 *
 * A note that embeds an image has one already, and the first one is almost
 * always the one the note is about, so that becomes the card's cover and the
 * drawn gradient steps aside. A note that would rather show a different one
 * says so in a `cover` property, which the metadata box writes when you pick
 * from the images the note holds.
 *
 * The order is: the cover you chose, then a picture fetched for a bookmark,
 * then the first thing the note embeds. Nothing at all means cover art.
 */

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
