/**
 * A video a bookmark points at.
 *
 * A clipped YouTube page is a title, a description and an `iframe`, because
 * there is no article on a watch page: the thing the page is about is the
 * video, and a card that opens into markdown shows everything except that.
 * So a bookmark whose source is a video opens as the video.
 *
 * Only the reading of the address is here, which is string work and testable.
 * The player is an `iframe` in the overlay, pointed at youtube-nocookie.com,
 * which is YouTube's own host for an embed that sets nothing until it plays.
 */

/** An id is eleven characters of YouTube's own alphabet, and nothing else. */
const ID = /^[\w-]{11}$/;

/**
 * The video an address points at, however it was written: `watch?v=`, a
 * `youtu.be` link, a short, a live page, or an embed. Anything else, including
 * a channel or a playlist on its own, is not a video and comes back as null.
 */
export function videoId(source: unknown): string | null {
	if (typeof source !== "string" || !source.trim()) return null;
	let url: URL;
	try {
		url = new URL(source.trim());
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^www\./i, "").toLowerCase();
	if (host === "youtu.be") return keep(url.pathname.split("/")[1]);
	if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
		return null;
	}
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts[0] === "watch") return keep(url.searchParams.get("v"));
	if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") {
		return keep(parts[1]);
	}
	return null;
}

function keep(id: string | null | undefined): string | null {
	const text = (id ?? "").trim();
	return ID.test(text) ? text : null;
}

/**
 * Where the player comes from. The nocookie host is YouTube's own, and it is
 * the one that stores nothing for a video nobody plays.
 */
export function embedUrl(id: string): string {
	return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}

/** The page the video is on, for the link beside the player. */
export function watchUrl(id: string): string {
	return `https://www.youtube.com/watch?v=${id}`;
}
