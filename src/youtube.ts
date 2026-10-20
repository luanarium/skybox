/**
 * What a watch page says, read out of the page itself.
 *
 * This is the second external service Skybox talks to, and it is a different
 * kind of talking from the first. Mastodon has an API with a token behind it.
 * YouTube's comments are not in the page it serves: the page carries a token
 * and an address, and the comments arrive from a POST to an endpoint YouTube
 * documents nowhere, which is what every tool that reads YouTube without a
 * Google key does. The trade was taken knowingly: no key to make, no quota to
 * mind, and no account anywhere, against a shape that will change without
 * warning. So everything here is written to come back empty rather than wrong,
 * and the card says so when it does.
 *
 * Nothing is sent but the continuation token the page gave us. Comments are
 * read only: there is no route here for posting one, voting on one, or saying
 * who is reading.
 */

export interface VideoComment {
	id: string;
	author: string;
	handle: string;
	avatar: string | null;
	/** As YouTube words it: "3 years ago", "2 months ago (edited)". */
	when: string;
	text: string;
	likes: string;
	pinned: boolean;
	/** How many replies hang off it, which is said rather than shown. */
	replies: number;
}

/** What the page has to give up before any comment can be asked for. */
export interface WatchPage {
	/** The key the page's own scripts use, which is public and in the HTML. */
	key: string;
	clientVersion: string;
	/** The token that stands for "the comments under this video". */
	token: string | null;
}

/** The blob of state the watch page ships its whole UI in. */
export function initialData(html: string): unknown {
	for (const start of ["var ytInitialData = ", 'window["ytInitialData"] = ']) {
		const at = html.indexOf(start);
		if (at === -1) continue;
		const json = balanced(html, at + start.length);
		if (!json) continue;
		try {
			return JSON.parse(json);
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * One JSON object, from its opening brace to the brace that closes it, with
 * strings and escapes skipped so a brace inside a comment does not end it.
 */
function balanced(text: string, from: number): string | null {
	const open = text.indexOf("{", from);
	if (open === -1) return null;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let at = open; at < text.length; at++) {
		const letter = text[at];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (letter === "\\") {
			escaped = quoted;
			continue;
		}
		if (letter === '"') {
			quoted = !quoted;
			continue;
		}
		if (quoted) continue;
		if (letter === "{") depth++;
		else if (letter === "}") {
			depth--;
			if (depth === 0) return text.slice(open, at + 1);
		}
	}
	return null;
}

/** The two values the page holds for its own requests, in plain sight. */
export function watchPage(html: string): WatchPage | null {
	const key = /"INNERTUBE_API_KEY":"([\w-]+)"/.exec(html)?.[1];
	const version = /"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/.exec(html)?.[1];
	if (!key) return null;
	return {
		key,
		clientVersion: version ?? "2.20240101.00.00",
		token: commentToken(initialData(html)),
	};
}

/**
 * The continuation token for the comments, which is the one thing the page
 * will not do without. It is found by its section rather than by position:
 * the page is a tree of renderers and the order of them is not ours to rely
 * on, but the comment section names itself.
 */
export function commentToken(data: unknown): string | null {
	const section = find(
		data,
		(node) => node.sectionIdentifier === "comment-item-section",
		60
	);
	if (!section) return null;
	const command = find(section, (node) => typeof node.token === "string" && !!node.token, 20);
	return typeof command?.token === "string" ? command.token : null;
}

type Bag = Record<string, unknown>;

/** First object in the tree that answers the question, breadth first. */
function find(data: unknown, asked: (node: Bag) => boolean, depth: number): Bag | null {
	if (depth < 0 || data === null || typeof data !== "object") return null;
	const queue: { node: unknown; left: number }[] = [{ node: data, left: depth }];
	while (queue.length > 0) {
		const { node, left } = queue.shift() as { node: unknown; left: number };
		if (left < 0 || node === null || typeof node !== "object") continue;
		if (!Array.isArray(node) && asked(node as Bag)) return node as Bag;
		for (const value of Object.values(node as Bag)) {
			if (value !== null && typeof value === "object") queue.push({ node: value, left: left - 1 });
		}
	}
	return null;
}

/**
 * Every object in the tree that answers the question, in the order the answer
 * was written. The order is the ranking: YouTube sends the comments it would
 * show first, first, and the top five means the first five.
 */
function all(data: unknown, asked: (node: Bag) => boolean): Bag[] {
	const found: Bag[] = [];
	walk(data, asked, found, 0);
	return found;
}

function walk(node: unknown, asked: (node: Bag) => boolean, found: Bag[], depth: number): void {
	if (depth > 80 || node === null || typeof node !== "object") return;
	if (!Array.isArray(node) && asked(node as Bag)) found.push(node as Bag);
	for (const value of Object.values(node as Bag)) walk(value, asked, found, depth + 1);
}

/**
 * The comments in an answer from the endpoint.
 *
 * YouTube has moved these twice. They were `commentRenderer` objects inside
 * the response; then the renderer became a view model holding a key, and the
 * words moved into a batch of entities delivered beside it. Both shapes are
 * read here, newest first, because a reader's copy of YouTube is whatever
 * YouTube served them this week.
 */
export function comments(answer: unknown, most = 5): VideoComment[] {
	const found = entityComments(answer);
	const old = found.length === 0 ? rendererComments(answer) : [];
	return [...found, ...old].slice(0, most);
}

/** The shape YouTube serves now: a payload per comment, keyed by id. */
function entityComments(answer: unknown): VideoComment[] {
	const payloads = all(answer, (node) => isBag(node.commentEntityPayload)).map(
		(node) => node.commentEntityPayload as Bag
	);
	const out: VideoComment[] = [];
	for (const payload of payloads) {
		const properties = bag(payload.properties);
		const author = bag(payload.author);
		const toolbar = bag(payload.toolbar);
		const text = pick(bag(properties.content).content, bag(properties.content).text);
		if (!text) continue;
		const key = pick(properties.commentId, payload.key) || `${out.length}`;
		out.push({
			id: key,
			author: pick(author.displayName) || "someone",
			handle: pick(author.displayName).replace(/^@/, ""),
			avatar: pick(author.avatarThumbnailUrl) || null,
			when: pick(properties.publishedTime),
			text,
			likes: pick(toolbar.likeCountNotliked, toolbar.likeCountLiked),
			pinned: Boolean(properties.pinnedText),
			replies: Number(pick(toolbar.replyCount) || 0) || 0,
		});
	}
	return out;
}

/** The shape before that, which some answers still carry. */
function rendererComments(answer: unknown): VideoComment[] {
	const renderers = all(answer, (node) => isBag(node.commentRenderer)).map(
		(node) => node.commentRenderer as Bag
	);
	const out: VideoComment[] = [];
	for (const renderer of renderers) {
		const text = runs(renderer.contentText);
		if (!text) continue;
		out.push({
			id: pick(renderer.commentId) || `${out.length}`,
			author: runs(renderer.authorText) || "someone",
			handle: runs(renderer.authorText).replace(/^@/, ""),
			avatar: thumb(renderer.authorThumbnail),
			when: runs(renderer.publishedTimeText),
			text,
			likes: pick(renderer.voteCount && bag(renderer.voteCount).simpleText) || runs(renderer.voteCount),
			pinned: Boolean(renderer.pinnedCommentBadge),
			replies: Number(pick(renderer.replyCount) || 0) || 0,
		});
	}
	return out;
}

/**
 * YouTube writes a line of text as a list of runs, so it can style parts of
 * it. The runs are joined as they are: a run ending in a space is a word
 * boundary, and trimming each one closes it up.
 */
function runs(value: unknown): string {
	const node = bag(value);
	if (typeof node.simpleText === "string") return node.simpleText.trim();
	const list = Array.isArray(node.runs) ? node.runs : [];
	return list
		.map((run) => {
			const text = bag(run).text;
			return typeof text === "string" ? text : "";
		})
		.join("")
		.trim();
}

function thumb(value: unknown): string | null {
	const list = bag(value).thumbnails;
	if (!Array.isArray(list) || list.length === 0) return null;
	return pick(bag(list[list.length - 1]).url) || null;
}

function isBag(value: unknown): value is Bag {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bag(value: unknown): Bag {
	return isBag(value) ? value : {};
}

/** The first of these that is a string worth having. */
function pick(...values: unknown[]): string {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return "";
}

/**
 * The top comments under a video, or an empty list.
 *
 * Two requests: the page, for the token and the key it carries, and then the
 * endpoint the page's own scripts call. `requestUrl` is Obsidian's fetch, so
 * this works on a phone as well and no browser is involved. The consent page
 * some regions get is stepped past the way YouTube's own link does it, with a
 * date far enough ahead to be no date at all.
 *
 * Anything unexpected is an empty list and a line in the console. A card that
 * cannot read the comments says so; it does not guess at them.
 */
export async function topComments(
	fetcher: (options: { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean }) => Promise<{ status: number; text: string; json?: unknown }>,
	id: string,
	most = 5
): Promise<{ comments: VideoComment[]; why: string }> {
	try {
		const page = await fetcher({
			url: `https://www.youtube.com/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`,
			method: "GET",
			headers: { "Accept-Language": "en-US,en;q=0.9" },
			throw: false,
		});
		if (page.status >= 400) return { comments: [], why: `YouTube answered ${page.status}` };
		const watch = watchPage(page.text);
		if (!watch) return { comments: [], why: "that page is not the one YouTube usually serves" };
		if (!watch.token) {
			return { comments: [], why: "comments are turned off, or there are none" };
		}
		const answer = await fetcher({
			url: `https://www.youtube.com/youtubei/v1/next?key=${watch.key}&prettyPrint=false`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				context: {
					client: { clientName: "WEB", clientVersion: watch.clientVersion, hl: "en" },
				},
				continuation: watch.token,
			}),
			throw: false,
		});
		if (answer.status >= 400) {
			return { comments: [], why: `YouTube answered ${answer.status}` };
		}
		const body = answer.json ?? parse(answer.text);
		const found = comments(body, most);
		return {
			comments: found,
			why: found.length === 0 ? "YouTube sent nothing this reader understands" : "",
		};
	} catch (error) {
		console.error("Skybox: could not read the comments", id, error);
		return { comments: [], why: "the comments could not be read" };
	}
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
