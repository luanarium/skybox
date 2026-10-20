/**
 * What kind of thing a bookmark points at.
 *
 * Searching for a video by typing "watch?" works until it does not: it finds
 * every note with that in its text and misses every video whose address is
 * written another way. The kind is not a word in the note, so it is not
 * searched for as one. A chip beginning `!` asks for a kind and nothing else,
 * and `!video` means "from a site that serves video", not "says video".
 *
 * Kinds are worked out from the address and never written into the vault. A
 * note is not retagged behind your back, nothing syncs, and the day this table
 * learns a new site every bookmark already saved knows its kind.
 */

/** The kinds, in the order they are offered. */
export const KINDS = ["video", "music", "code", "social", "shop", "wiki", "read"] as const;

export type Kind = (typeof KINDS)[number];

/**
 * Hosts, by what they are for. A bare name matches that host and anything
 * under it, so `youtube.com` covers `www.` and `m.`; a name starting with a
 * dot matches only below it, which is how one host serves two kinds.
 */
const HOSTS: Record<Kind, string[]> = {
	video: [
		"youtube.com",
		"youtu.be",
		"vimeo.com",
		"dailymotion.com",
		"twitch.tv",
		"odysee.com",
		"rumble.com",
		"tiktok.com",
		"nebula.tv",
		"ted.com",
		"veoh.com",
		"bitchute.com",
	],
	music: [
		"music.youtube.com",
		"bandcamp.com",
		"soundcloud.com",
		"mixcloud.com",
		"open.spotify.com",
		"spotify.com",
		"last.fm",
		"discogs.com",
		"genius.com",
		"beatport.com",
		"jamendo.com",
		"audius.co",
	],
	code: [
		"github.com",
		"gitlab.com",
		"codeberg.org",
		"bitbucket.org",
		"sourceforge.net",
		"npmjs.com",
		"pypi.org",
		"crates.io",
		"rubygems.org",
		"stackoverflow.com",
		"stackexchange.com",
	],
	social: [
		"reddit.com",
		"x.com",
		"twitter.com",
		"bsky.app",
		"tumblr.com",
		"instagram.com",
		"threads.net",
		"facebook.com",
		"linkedin.com",
		"mastodon.social",
		"lemmy.world",
	],
	shop: [
		"ebay.com",
		"ebay.co.uk",
		"amazon.com",
		"amazon.co.uk",
		"etsy.com",
		"aliexpress.com",
		"alibaba.com",
		"mercari.com",
		"depop.com",
		"gumtree.com",
		"craigslist.org",
	],
	wiki: ["wikipedia.org", "wiktionary.org", "fandom.com", "wikia.com", "archive.org", "wikihow.com"],
	read: [
		"medium.com",
		"substack.com",
		"dev.to",
		"hackernoon.com",
		"news.ycombinator.com",
		"arxiv.org",
		"jstor.org",
	],
};

/**
 * The kinds an address belongs to, usually one and sometimes none. A host that
 * serves two things can answer twice: `music.youtube.com` is music, and it is
 * still video.
 */
export function kindsOf(source: unknown): Kind[] {
	const host = hostOf(source);
	if (!host) return [];
	const found: Kind[] = [];
	for (const kind of KINDS) {
		if (HOSTS[kind].some((name) => matches(host, name))) found.push(kind);
	}
	return found;
}

/** Whether this is a kind at all, for reading a chip. */
export function isKind(word: string): word is Kind {
	return (KINDS as readonly string[]).includes(word.toLowerCase());
}

function hostOf(source: unknown): string | null {
	if (typeof source !== "string" || !source.trim()) return null;
	try {
		const url = new URL(source.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

/**
 * A host matches a name when it is that name or sits under it, so a country
 * shop and a language wiki both land where they belong: `amazon.co.uk` is
 * named, and `en.wikipedia.org` is under `wikipedia.org`.
 */
function matches(host: string, name: string): boolean {
	return host === name || host.endsWith(`.${name}`);
}
