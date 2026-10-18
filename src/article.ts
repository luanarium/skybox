/**
 * The page itself, not just what it says about itself.
 *
 * Extraction is the hard part of saving a web page: telling the article from
 * the newsletter box, the cookie notice and the related-stories rail. Defuddle
 * is the library Obsidian's own Web Clipper uses for exactly this, so a
 * bookmark here gets the same reading the clipper would have given it, without
 * a browser extension and without anyone pressing a button.
 *
 * It is the one dependency this plugin has taken on beyond React, pinned to an
 * exact version, reached only from here, and only ever on desktop: the fetch
 * that feeds it does not run on a phone.
 */

import type { DefuddleResponse } from "defuddle";

/** Where the article sits in the note, and how it is found again. */
export const ARTICLE_HEADING = "## Page text";

export interface Article {
	markdown: string;
	words: number;
}

/**
 * Pulls the article out of a page. The HTML is parsed here rather than handed
 * over as a string, because Defuddle reads a `Document`, which is also why
 * this never runs where there is no DOM.
 */
export async function extractArticle(html: string, url: string): Promise<Article | null> {
	if (typeof DOMParser === "undefined") return null;
	try {
		// Loaded on the first article rather than at startup: a vault that
		// never imports a bookmark never runs any of it.
		const { default: Defuddle } = await import("defuddle");
		const doc = new DOMParser().parseFromString(html, "text/html");
		const result = new Defuddle(doc, { url, markdown: true }).parse() as DefuddleResponse;
		const markdown = (result.contentMarkdown ?? result.content ?? "").trim();
		if (!markdown) return null;
		return { markdown, words: result.wordCount ?? countWords(markdown) };
	} catch (error) {
		console.error("Skybox: could not read the article at", url, error);
		return null;
	}
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Where the article goes in a note: at the end, under a heading of its own, so
 * whatever you wrote above it stays yours and stays first. A note that already
 * carries one is left alone, because the copy in the vault may have been
 * edited and the page may have changed.
 */
export function withArticle(note: string, article: Article): string {
	if (note.includes(ARTICLE_HEADING)) return note;
	return `${note.trimEnd()}\n\n${ARTICLE_HEADING}\n\n${article.markdown}\n`;
}

/** Whether a note already holds the page's text. */
export function hasArticle(note: string): boolean {
	return note.includes(ARTICLE_HEADING);
}
