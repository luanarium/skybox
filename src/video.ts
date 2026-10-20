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

/**
 * The same player, with its own scripts answering ours. `enablejsapi` is what
 * lets a page drive an embed by posting messages at it, which is how the
 * skinned player works: YouTube draws the picture, the skin holds the
 * buttons.
 */
export function playerUrl(id: string): string {
	return `https://www.youtube-nocookie.com/embed/${id}?rel=0&enablejsapi=1&playsinline=1`;
}

/**
 * One instruction for an embed, in the shape its own scripts use. There is no
 * library here and nothing loaded from Google to do it: the embed listens for
 * these on its window, and this is the whole of the protocol we need.
 */
export function playerMessage(func: string, args: unknown[] = []): string {
	return JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" });
}

/** What the embed wants before it will say anything back. */
export function listenMessage(): string {
	return JSON.stringify({ event: "listening", id: 1, channel: "widget" });
}

/**
 * What the embed says back, where it says anything. A phone, a slow network
 * or a changed protocol all end the same way: no numbers, which the display
 * shows as no numbers rather than as zero.
 */
export interface PlayerState {
	at: number | null;
	length: number | null;
	/** YouTube's own: 1 playing, 2 paused, 0 ended, 3 buffering. */
	playing: boolean | null;
}

export function playerState(data: unknown): PlayerState | null {
	if (typeof data !== "string") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const body = parsed as Record<string, unknown>;
	const event = typeof body.event === "string" ? body.event : "";
	if (event !== "infoDelivery" && event !== "initialDelivery" && event !== "onStateChange") {
		return null;
	}
	const info = (body.info ?? body) as Record<string, unknown>;
	const at = typeof info.currentTime === "number" ? info.currentTime : null;
	const length = typeof info.duration === "number" && info.duration > 0 ? info.duration : null;
	const state = typeof info.playerState === "number" ? info.playerState : null;
	if (at === null && length === null && state === null) return null;
	return { at, length, playing: state === null ? null : state === 1 };
}

/** Seconds as a player shows them, and nothing as dashes rather than zero. */
export function clock(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
	const whole = Math.floor(seconds);
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	const padded = `${rest}`.padStart(2, "0");
	if (minutes < 100) return `${`${minutes}`.padStart(2, "0")}:${padded}`;
	// An eight-hour mix is still a time, just a wider one.
	const hours = Math.floor(minutes / 60);
	return `${hours}:${`${minutes % 60}`.padStart(2, "0")}:${padded}`;
}
