/**
 * What a page says about itself.
 *
 * Pages declare a summary for the social cards other sites show: a title, a
 * description, an image, sometimes an author and a date. Reading those is one
 * request and some string work, and it turns a bookmark from a link into
 * something that looks like the page it points at.
 *
 * Reading the article itself is a different job, and a much harder one:
 * telling the story from the newsletter box and the cookie notice is what
 * libraries like Defuddle exist for. Nothing here attempts it.
 *
 * The parsing is deliberately string work rather than `DOMParser`, so it can
 * be tested without a browser, and so a page that is half-broken HTML still
 * yields what it declared in its head.
 */

export interface PageMeta {
	title: string | null;
	description: string | null;
	/** Absolute URL of the image the page offers for a preview. */
	image: string | null;
	author: string | null;
	/** ISO date, where the page gave something a date can be read from. */
	published: string | null;
	/** The publication's name, where it gives one. */
	site: string | null;
}

export const EMPTY_META: PageMeta = {
	title: null,
	description: null,
	image: null,
	author: null,
	published: null,
	site: null,
};

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	"#39": "'",
	"#x27": "'",
	"#x2F": "/",
	"#47": "/",
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
		const known = ENTITIES[name];
		if (known) return known;
		if (/^#\d+$/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
		if (/^#x[0-9a-fA-F]+$/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
		return whole;
	});
}

function clean(value: string | null): string | null {
	if (value === null) return null;
	const text = decodeEntities(value).replace(/\s+/g, " ").trim();
	return text || null;
}

/** Every `<meta>` in the document, by whichever of `property` or `name` it used. */
function metaTags(html: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
		const key =
			/\b(?:property|name|itemprop)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ??
			null;
		const value = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
		if (!key || !value) continue;
		const content = value[1] ?? value[2] ?? value[3] ?? "";
		// First declaration wins: pages repeat these, and the head comes first.
		if (!found.has(key) && content.trim()) found.set(key, content);
	}
	return found;
}

/** `<title>`, for a page that declared nothing else. */
function titleTag(html: string): string | null {
	return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
}

/** Relative image URLs are common; a vault needs the absolute one. */
export function absoluteUrl(value: string | null, base: string): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (trimmed.startsWith("//")) return `${base.split(":")[0]}:${trimmed}`;
	const origin = /^(https?:\/\/[^/]+)(\/[^?#]*)?/i.exec(base);
	if (!origin) return null;
	if (trimmed.startsWith("/")) return `${origin[1]}${trimmed}`;
	const directory = (origin[2] ?? "/").replace(/[^/]*$/, "");
	return `${origin[1]}${directory}${trimmed}`;
}

/** A date a page declared, as `YYYY-MM-DD`, or nothing it could not read. */
export function readDate(value: string | null): string | null {
	if (!value) return null;
	const time = Date.parse(value.trim());
	if (Number.isNaN(time)) return null;
	return new Date(time).toISOString().slice(0, 10);
}

/**
 * What the page declared, preferring Open Graph (which pages maintain for
 * other people's sake) over the older plain `name=` metadata.
 */
export function parseMetadata(html: string, url: string): PageMeta {
	// Comments can hold anything, including other pages' tags.
	const head = html.replace(/<!--[\s\S]*?-->/g, "");
	const meta = metaTags(head);
	const first = (...keys: string[]): string | null => {
		for (const key of keys) {
			const value = meta.get(key);
			if (value) return value;
		}
		return null;
	};

	return {
		title: clean(first("og:title", "twitter:title", "title") ?? titleTag(head)),
		description: clean(first("og:description", "twitter:description", "description")),
		image: absoluteUrl(clean(first("og:image", "og:image:url", "twitter:image")), url),
		author: clean(first("article:author", "author", "og:article:author", "twitter:creator")),
		published: readDate(
			clean(first("article:published_time", "og:article:published_time", "datepublished", "date"))
		),
		site: clean(first("og:site_name", "application-name", "twitter:site")),
	};
}

/** Whether anything at all came back worth writing down. */
export function hasMeta(meta: PageMeta): boolean {
	return Boolean(meta.description || meta.image || meta.author || meta.published || meta.site);
}
