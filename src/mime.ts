/**
 * Reading a mail message.
 *
 * A message is bytes with a shape: folded headers, words encoded for the
 * seven-bit transports of 1992, a body that may be one thing or a tree of
 * alternatives and attachments, each part with its own encoding and its own
 * character set. None of that needs a library here, because the browser
 * already carries the hard parts: `TextDecoder` knows the character sets and
 * `atob` knows base64.
 *
 * Everything in this file is pure. The raw message arrives as a string whose
 * code units are the message's bytes, which is what reading a file as
 * `latin1` gives, so a part can be turned back into bytes and decoded with
 * whatever character set it declared.
 */

export interface MailAddress {
	name: string;
	address: string;
}

export interface MailAttachment {
	name: string;
	type: string;
	/** Bytes, as declared by what was decoded. */
	size: number;
}

export interface MailMessage {
	id: string;
	inReplyTo: string | null;
	/** Every id this message answers, oldest first. */
	references: string[];
	subject: string;
	from: MailAddress;
	to: MailAddress[];
	/** Milliseconds since the epoch, or 0 where the date made no sense. */
	date: number;
	text: string;
	html: string;
	attachments: MailAttachment[];
}

/** Headers, unfolded, with the body that follows them. */
export function splitHeaders(raw: string): { headers: Map<string, string[]>; body: string } {
	const normalised = raw.replace(/\r\n/g, "\n");
	const end = normalised.indexOf("\n\n");
	const head = end === -1 ? normalised : normalised.slice(0, end);
	const body = end === -1 ? "" : normalised.slice(end + 2);

	const headers = new Map<string, string[]>();
	// A header continues while the next line begins with whitespace.
	const unfolded = head.replace(/\n[ \t]+/g, " ");
	for (const line of unfolded.split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const name = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		const already = headers.get(name);
		if (already) already.push(value);
		else headers.set(name, [value]);
	}
	return { headers, body };
}

/** `=?utf-8?B?…?=` and `=?iso-8859-1?Q?…?=`, as headers have carried words since 1992. */
export function decodeWords(value: string): string {
	return value.replace(
		/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g,
		(_whole, charset: string, kind: string, text: string) => {
			const bytes =
				kind.toLowerCase() === "b"
					? fromBase64(text)
					: fromLatin1(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
							String.fromCharCode(parseInt(hex, 16))
						));
			return decodeBytes(bytes, charset);
		}
	);
}

/** `text/plain; charset="utf-8"` into its parts. */
export function parseContentType(value: string): { type: string; params: Record<string, string> } {
	const [first, ...rest] = value.split(";");
	const params: Record<string, string> = {};
	for (const piece of rest) {
		const equals = piece.indexOf("=");
		if (equals === -1) continue;
		const name = piece.slice(0, equals).trim().toLowerCase();
		const raw = piece.slice(equals + 1).trim();
		params[name] = raw.replace(/^"|"$/g, "");
	}
	return { type: (first ?? "").trim().toLowerCase() || "text/plain", params };
}

/** `Marion <marion@example.org>`, `marion@example.org`, and lists of either. */
export function parseAddresses(value: string): MailAddress[] {
	const found: MailAddress[] = [];
	// Commas inside a quoted display name are not separators.
	for (const piece of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
		const text = decodeWords(piece.trim());
		if (!text) continue;
		const angled = /^(.*)<([^>]+)>\s*$/.exec(text);
		if (angled) {
			found.push({
				name: angled[1].trim().replace(/^"|"$/g, ""),
				address: angled[2].trim(),
			});
		} else {
			found.push({ name: "", address: text });
		}
	}
	return found;
}

function fromLatin1(text: string): Uint8Array {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
	return bytes;
}

function fromBase64(text: string): Uint8Array {
	try {
		return fromLatin1(atob(text.replace(/[^A-Za-z0-9+/=]/g, "")));
	} catch {
		return new Uint8Array(0);
	}
}

function fromQuotedPrintable(text: string): Uint8Array {
	const joined = text.replace(/=\r?\n/g, "");
	const out: number[] = [];
	for (let i = 0; i < joined.length; i++) {
		const char = joined[i];
		if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
			out.push(parseInt(joined.slice(i + 1, i + 3), 16));
			i += 2;
		} else {
			out.push(joined.charCodeAt(i) & 0xff);
		}
	}
	return Uint8Array.from(out);
}

/** Whatever the part said it was, as text this century can read. */
export function decodeBytes(bytes: Uint8Array, charset: string): string {
	const label = (charset || "utf-8").toLowerCase().replace(/^['"]|['"]$/g, "");
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		// A character set nobody has heard of is read as Latin-1, which at
		// least never throws and leaves the letters legible.
		return new TextDecoder("iso-8859-1").decode(bytes);
	}
}

function decodePart(body: string, encoding: string, charset: string): string {
	const how = encoding.toLowerCase().trim();
	if (how === "base64") return decodeBytes(fromBase64(body), charset);
	if (how === "quoted-printable") return decodeBytes(fromQuotedPrintable(body), charset);
	return decodeBytes(fromLatin1(body), charset);
}

interface Gathered {
	text: string;
	html: string;
	attachments: MailAttachment[];
}

/** Walks a part and whatever hangs off it, collecting what a reader wants. */
function gather(raw: string, found: Gathered): void {
	const { headers, body } = splitHeaders(raw);
	const contentType = parseContentType(headers.get("content-type")?.[0] ?? "text/plain");
	const encoding = headers.get("content-transfer-encoding")?.[0] ?? "7bit";
	const disposition = headers.get("content-disposition")?.[0] ?? "";

	if (contentType.type.startsWith("multipart/")) {
		const boundary = contentType.params.boundary;
		if (!boundary) return;
		// A newline in front, because the first boundary may open the body with
		// no preamble before it, and losing it loses the first part.
		const pieces = `\n${body}`.split(
			new RegExp(`\n--${escapeForRegExp(boundary)}(--)?[ \t]*(?=\n|$)`)
		);
		// The first piece is the preamble, which is for mail readers of 1994.
		for (const piece of pieces.slice(1)) {
			if (piece === undefined || piece === "--" || !piece.trim()) continue;
			gather(piece.replace(/^\n/, ""), found);
		}
		return;
	}

	const attached = /attachment/i.test(disposition) || Boolean(contentType.params.name);
	if (attached) {
		const name =
			/filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? contentType.params.name ?? "attachment";
		const bytes =
			encoding.toLowerCase().trim() === "base64"
				? fromBase64(body).length
				: fromLatin1(body).length;
		found.attachments.push({ name: decodeWords(name), type: contentType.type, size: bytes });
		return;
	}

	const text = decodePart(body, encoding, contentType.params.charset ?? "utf-8");
	if (contentType.type === "text/html") found.html = found.html || text;
	else if (contentType.type.startsWith("text/")) found.text = found.text || text;
}

function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The id in `<angle brackets>`, which is how messages refer to each other. */
export function parseMessageId(value: string | undefined): string | null {
	const found = /<([^>]+)>/.exec(value ?? "");
	return found ? found[1] : (value ?? "").trim() || null;
}

export function parseMessage(raw: string): MailMessage {
	const { headers } = splitHeaders(raw);
	const first = (name: string): string => headers.get(name)?.[0] ?? "";
	const found: Gathered = { text: "", html: "", attachments: [] };
	gather(raw, found);

	const date = Date.parse(first("date"));
	const from = parseAddresses(first("from"))[0] ?? { name: "", address: "" };

	return {
		id: parseMessageId(first("message-id")) ?? "",
		inReplyTo: parseMessageId(first("in-reply-to")),
		references: (first("references").match(/<[^>]+>/g) ?? []).map(
			(each) => each.slice(1, -1)
		),
		subject: decodeWords(first("subject")).trim(),
		from,
		to: parseAddresses(first("to")),
		date: Number.isNaN(date) ? 0 : date,
		text: found.text,
		html: found.html,
		attachments: found.attachments,
	};
}

/** What a thread is called, once the Re: and Fwd: are taken off. */
export function threadSubject(subject: string): string {
	return subject.replace(/^((re|fwd?|aw|sv)\s*(\[\d+\])?:\s*)+/i, "").trim();
}
