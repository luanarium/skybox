import { prepareSimpleSearch } from "obsidian";
import type { VaultIndex } from "./index";
import { ARTICLE_HEADING } from "./article";
import { isKind } from "./kinds";
import { MAIL_TAG } from "./thread";
import type { Item } from "./types";

export interface Chip {
	/** The word as typed, without a leading `#` or `!`. */
	text: string;
	/** `#word` matches tags only. */
	tagOnly: boolean;
	/**
	 * `!video` matches what the bookmarked address is for, and nothing else:
	 * not the title, not the tags, not a word in the text. A note that says
	 * "video" is not a video.
	 */
	kindOnly?: boolean;
}

export function toChip(word: string): Chip | null {
	const trimmed = word.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#")) return { text: trimmed.slice(1), tagOnly: true };
	// `!` is the kind of thing, where there is a kind of that name. Anything
	// else beginning with it is a word somebody typed, bang and all.
	const asked = trimmed.slice(1);
	if (trimmed.startsWith("!") && isKind(asked)) {
		return { text: asked.toLowerCase(), tagOnly: false, kindOnly: true };
	}
	return { text: trimmed, tagOnly: false };
}

export function chipLabel(chip: Chip): string {
	if (chip.kindOnly) return `!${chip.text}`;
	return chip.tagOnly ? `#${chip.text}` : chip.text;
}

/**
 * An image a note embeds is part of that note's page rather than something
 * kept for its own sake, so it stays out of the everything view. It is not
 * gone: any search reaches it, and `#embedded` asks for exactly these.
 */
export function unembedded(items: Item[]): Item[] {
	return items.filter((item) => !item.embedded);
}

/**
 * Chips are ANDed. Each word is matched against title, path, tags, headings and
 * then the note's text; `#word` is matched against tags alone. With no chips
 * every card surfaces, most recently modified first — bar the embedded ones,
 * when the setting says so.
 */
export async function search(
	index: VaultIndex,
	chips: Chip[],
	hideEmbedded = false
): Promise<Item[]> {
	const all = index.all();
	if (chips.length === 0) return hideEmbedded ? unembedded(all) : all;

	// Asking for conversations is asking what is waiting in them, so the
	// unread ones come first and the rest keep their order.
	const wantsMail = chips.some((chip) => chip.tagOnly && chip.text.toLowerCase() === MAIL_TAG);

	const matchers = chips.map((chip) =>
		chip.tagOnly || chip.kindOnly ? null : prepareSimpleSearch(chip.text)
	);
	const scored: { item: Item; score: number }[] = [];

	for (const item of all) {
		let score = 0;
		let matched = true;
		for (let i = 0; i < chips.length; i++) {
			const chip = chips[i];
			const matcher = matchers[i];
			if (!matcher) {
				// A kind is asked for exactly: it is not a word to be found
				// in a note, which is the whole point of asking for it.
				const yes = chip.kindOnly
					? item.kinds.includes(chip.text)
					: matchesTag(item, chip.text);
				if (!yes) {
					matched = false;
					break;
				}
				score += 1;
				continue;
			}
			let result = matcher(metaText(item));
			if (!result) result = matcher(await index.content(item));
			if (!result) {
				matched = false;
				break;
			}
			score += result.score;
		}
		if (matched) scored.push({ item, score });
	}

	scored.sort((a, b) => {
		if (wantsMail && a.item.unread !== b.item.unread) return a.item.unread ? -1 : 1;
		return b.score - a.score || b.item.mtime - a.item.mtime;
	});
	return scored.map((entry) => entry.item);
}

function matchesTag(item: Item, word: string): boolean {
	const needle = word.toLowerCase();
	return item.tags.some((tag) => tag.toLowerCase().includes(needle));
}

/** Everything about an item that is cheap to match, tried before its text. */
function metaText(item: Item): string {
	return [item.title, item.file.path, item.tags.join(" "), item.headings.join(" ")].join("\n");
}

/** First plain words of a note, for the card's excerpt. */
export function plainExcerpt(content: string, limit = 240): string {
	let text = content;
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) text = text.slice(end + 4);
	}
	// A bookmark keeps the whole page under a heading of its own. That is for
	// searching, not for reading at a glance: a card shows what the note says
	// above it, which is the page's own description.
	const article = text.indexOf(ARTICLE_HEADING);
	if (article !== -1) text = text.slice(0, article);
	text = text
		// A bare link on its own line is the bookmark's own URL, which the
		// title already says.
		.replace(/^\s*<https?:\/\/[^>]*>\s*$/gm, " ")
		// Anything that came in as HTML rather than markdown.
		.replace(/<[^>]+>/g, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/[*_`>#-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
