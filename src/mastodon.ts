import { requestUrl } from "obsidian";

/**
 * The one external service this plugin talks to, and only where an account
 * has been connected and a note has been tagged for it.
 *
 * Mastodon's API is plain JSON over HTTPS with a bearer token, so there is no
 * library here: `requestUrl` is Obsidian's own fetch, which also sidesteps
 * CORS. Everything that can be worked out without a server, composing a post
 * and building a multipart body among it, is a pure function below and tested
 * as one.
 *
 * The token never passes through here from `data.json`. It is held in the
 * vault's local storage, which does not sync and does not sit among the
 * notes, and handed in per call.
 */

export interface MastodonAccount {
	id: string;
	username: string;
	/** The account's page, for showing who is connected. */
	url: string;
}

export interface MastodonStatus {
	id: string;
	url: string;
	content: string;
	repliesCount: number;
	favouritesCount: number;
	reblogsCount: number;
}

export type Visibility = "public" | "unlisted" | "private" | "direct";

/** One post in the thread under a shared card. */
export interface MastodonReply {
	id: string;
	/** The display name, falling back to the handle where there is none. */
	author: string;
	handle: string;
	avatar: string;
	text: string;
	url: string;
	/** ISO 8601, as the server gives it. */
	at: string;
	favouritesCount: number;
	/** What this one answers: another reply, or the post itself. */
	inReplyTo: string | null;
}

/** A reply with whatever answers it, so a thread reads as a thread. */
export interface ThreadNode {
	reply: MastodonReply;
	children: ThreadNode[];
}

/**
 * A thread is a tree: Mastodon hands back the descendants of a post as a flat
 * list, each saying what it answers, and a client puts them back together.
 * Anything whose parent is missing from the list hangs off the root, so a
 * reply is never lost to a gap.
 */
export function threadTree(replies: MastodonReply[], rootId: string): ThreadNode[] {
	const nodes = new Map<string, ThreadNode>();
	for (const reply of replies) nodes.set(reply.id, { reply, children: [] });

	const roots: ThreadNode[] = [];
	for (const reply of replies) {
		const node = nodes.get(reply.id);
		if (!node) continue;
		const parent = reply.inReplyTo && reply.inReplyTo !== rootId ? nodes.get(reply.inReplyTo) : null;
		if (parent && parent !== node) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

/** `mastodon.social`, `https://mastodon.social/`, and the like, all one thing. */
export function normalizeInstance(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) return "";
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	return withScheme.replace(/\/+$/, "");
}

/**
 * What goes out: the note's own words where there are any, then the link.
 * The link is kept whole whatever has to go, because a post whose text is
 * truncated still works and a post with half a URL does not.
 */
export function composePost(
	parts: { title: string; link?: string | null; body?: string | null },
	limit = 500
): string {
	const link = parts.link?.trim() ?? "";
	const body = (parts.body ?? "").trim();
	const title = parts.title.trim();
	const tail = link ? `\n\n${link}` : "";
	const room = limit - tail.length;

	let text = body && body !== title ? `${title}\n\n${body}` : title;
	if (text.length > room) {
		text = `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
	}
	return `${text}${tail}`.trim();
}

/** The multipart body `POST /api/v2/media` wants, built by hand. */
export function multipartBody(
	boundary: string,
	fields: Record<string, string>,
	file: { name: string; type: string; bytes: ArrayBuffer }
): ArrayBuffer {
	const encoder = new TextEncoder();
	const head: string[] = [];
	for (const [name, value] of Object.entries(fields)) {
		head.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
	}
	head.push(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
			`Content-Type: ${file.type}\r\n\r\n`
	);
	const prefix = encoder.encode(head.join(""));
	const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(prefix.length + file.bytes.byteLength + suffix.length);
	body.set(prefix, 0);
	body.set(new Uint8Array(file.bytes), prefix.length);
	body.set(suffix, prefix.length + file.bytes.byteLength);
	return body.buffer;
}

/** Status content arrives as the server's HTML; a vault wants words. */
export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export class MastodonError extends Error {}

export class Mastodon {
	constructor(
		private instance: string,
		private token: string
	) {}

	private async call(
		path: string,
		options: { method?: string; json?: unknown; body?: ArrayBuffer; contentType?: string } = {}
	): Promise<unknown> {
		const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
		if (options.contentType) headers["Content-Type"] = options.contentType;
		if (options.json !== undefined) headers["Content-Type"] = "application/json";

		const response = await requestUrl({
			url: `${this.instance}${path}`,
			method: options.method ?? "GET",
			headers,
			body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
			throw: false,
		});
		if (response.status >= 400) {
			// The server says why in a JSON `error` more often than not.
			let detail = `HTTP ${response.status}`;
			try {
				const said = response.json as { error?: string } | undefined;
				if (said?.error) detail = said.error;
			} catch {
				// A server that does not explain itself is still a failure.
			}
			throw new MastodonError(detail);
		}
		return response.json;
	}

	/** Who the token belongs to, and whether it works at all. */
	async verify(): Promise<MastodonAccount> {
		const account = (await this.call("/api/v1/accounts/verify_credentials")) as {
			id: string;
			username: string;
			url: string;
		};
		return { id: account.id, username: account.username, url: account.url };
	}

	/** How long a post may be here, which differs by instance. */
	async maxCharacters(): Promise<number> {
		try {
			const instance = (await this.call("/api/v1/instance")) as {
				configuration?: { statuses?: { max_characters?: number } };
			};
			return instance.configuration?.statuses?.max_characters ?? 500;
		} catch {
			return 500;
		}
	}

	async post(
		text: string,
		visibility: Visibility,
		mediaIds: string[] = [],
		inReplyTo?: string
	): Promise<MastodonStatus> {
		const status = (await this.call("/api/v1/statuses", {
			method: "POST",
			json: {
				status: text,
				visibility,
				media_ids: mediaIds.length > 0 ? mediaIds : undefined,
				in_reply_to_id: inReplyTo,
			},
		})) as Record<string, unknown>;
		return readStatus(status);
	}

	/** What has been said under a post, oldest first. */
	async replies(id: string): Promise<MastodonReply[]> {
		const context = (await this.call(`/api/v1/statuses/${id}/context`)) as {
			descendants?: Record<string, unknown>[];
		};
		return (context.descendants ?? []).map(readReply);
	}

	/** An image goes up first and is referenced by the post that follows. */
	async uploadMedia(bytes: ArrayBuffer, type: string, name: string, alt: string): Promise<string> {
		const boundary = `skybox${Date.now().toString(16)}`;
		const media = (await this.call("/api/v2/media", {
			method: "POST",
			body: multipartBody(boundary, alt ? { description: alt } : {}, { name, type, bytes }),
			contentType: `multipart/form-data; boundary=${boundary}`,
		})) as { id: string };
		return media.id;
	}

	async status(id: string): Promise<MastodonStatus | null> {
		try {
			return readStatus((await this.call(`/api/v1/statuses/${id}`)) as Record<string, unknown>);
		} catch {
			// Deleted on the server, or never ours: either way there is nothing
			// to show beside the note.
			return null;
		}
	}

	async deleteStatus(id: string): Promise<void> {
		await this.call(`/api/v1/statuses/${id}`, { method: "DELETE" });
	}
}

function readReply(raw: Record<string, unknown>): MastodonReply {
	const account = (raw.account ?? {}) as Record<string, unknown>;
	const handle = String(account.acct ?? account.username ?? "");
	return {
		id: String(raw.id ?? ""),
		author: String(account.display_name || handle),
		handle,
		avatar: typeof account.avatar_static === "string" ? account.avatar_static : "",
		text: htmlToText(typeof raw.content === "string" ? raw.content : ""),
		url: typeof raw.url === "string" ? raw.url : "",
		at: String(raw.created_at ?? ""),
		favouritesCount: Number(raw.favourites_count ?? 0),
		inReplyTo: raw.in_reply_to_id ? String(raw.in_reply_to_id) : null,
	};
}

function readStatus(raw: Record<string, unknown>): MastodonStatus {
	return {
		id: String(raw.id ?? ""),
		url: typeof raw.url === "string" ? raw.url : "",
		content: typeof raw.content === "string" ? raw.content : "",
		repliesCount: Number(raw.replies_count ?? 0),
		favouritesCount: Number(raw.favourites_count ?? 0),
		reblogsCount: Number(raw.reblogs_count ?? 0),
	};
}
