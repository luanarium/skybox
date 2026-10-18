import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	decodeWords,
	parseAddresses,
	parseContentType,
	parseMessage,
	parseMessageId,
	splitHeaders,
	threadSubject,
} from "../src/mime";
import { isSeen, parseFlags, seenName } from "../src/maildir";

// Headers unfold, repeat, and fold their case away.
const split = splitHeaders("Subject: one\r\n two\r\nTo: a@b\r\nTo: c@d\r\n\r\nbody here\r\n");
assert.strictEqual(split.headers.get("subject")?.[0], "one two", "a folded header is one value");
assert.deepStrictEqual(split.headers.get("to"), ["a@b", "c@d"], "a repeated header keeps both");
assert.strictEqual(split.body, "body here\n");
assert.strictEqual(splitHeaders("no headers at all").body, "");

// Words encoded for the transports of 1992.
assert.strictEqual(decodeWords("=?utf-8?B?U2FsdXQ=?="), "Salut");
assert.strictEqual(decodeWords("=?iso-8859-1?Q?Gr=FC=DFe?="), "Grüße");
assert.strictEqual(decodeWords("=?utf-8?Q?a_b?="), "a b", "underscore is a space in Q");
assert.strictEqual(decodeWords("plain subject"), "plain subject");
assert.strictEqual(decodeWords("=?nonsense?Q?x?="), "x", "an unknown charset still reads");

// Content types and their parameters.
assert.deepStrictEqual(parseContentType('text/plain; charset="utf-8"'), {
	type: "text/plain",
	params: { charset: "utf-8" },
});
assert.strictEqual(parseContentType("").type, "text/plain");
assert.strictEqual(parseContentType("MULTIPART/Alternative; boundary=x").type, "multipart/alternative");

// Addresses, with and without a name, and lists of them.
assert.deepStrictEqual(parseAddresses("Marion <marion@example.org>"), [
	{ name: "Marion", address: "marion@example.org" },
]);
assert.deepStrictEqual(parseAddresses("a@b, C D <c@d>").map((x) => x.address), ["a@b", "c@d"]);
assert.deepStrictEqual(parseAddresses('"Last, First" <x@y>'), [{ name: "Last, First", address: "x@y" }]);
assert.deepStrictEqual(parseAddresses(""), []);

assert.strictEqual(parseMessageId("<abc@d>"), "abc@d");
assert.strictEqual(parseMessageId(undefined), null);

assert.strictEqual(threadSubject("Re: Re: the grid idea"), "the grid idea");
assert.strictEqual(threadSubject("FWD: lunch"), "lunch");
assert.strictEqual(threadSubject("plain"), "plain");

// Maildir flags live in the filename.
assert.ok(isSeen("123.host:2,S"));
assert.ok(!isSeen("123.host"));
assert.ok(parseFlags("1.h:2,FS").has("F"));
assert.strictEqual(seenName("1.h"), "1.h:2,S");
assert.strictEqual(seenName("1.h:2,F"), "1.h:2,FS", "flags stay in order");
assert.strictEqual(seenName("1.h:2,S"), "1.h:2,S", "already read stays as it is");

// The messages seeded into the sample Maildir: every shape a reader meets.
const mailbox = path.join(os.homedir(), "Mail/mail/INBOX");
const read = (match: string): string => {
	for (const folder of ["new", "cur"]) {
		const directory = path.join(mailbox, folder);
		if (!fs.existsSync(directory)) continue;
		const name = fs.readdirSync(directory).find((each) => each.includes(match));
		if (name) return fs.readFileSync(path.join(directory, name), "latin1");
	}
	throw new Error(`no sample message matching ${match}`);
};

const plain = parseMessage(read("plain"));
assert.strictEqual(plain.subject, "Lunch on Thursday?");
assert.strictEqual(plain.from.name, "Marion");
assert.strictEqual(plain.from.address, "marion@example.org");
assert.ok(plain.text.includes("sandwiches you like"), plain.text);
assert.ok(plain.date > 0, "the date is read");

// Multipart alternative: both parts kept, quoted-printable decoded.
const alternative = parseMessage(read("alternative"));
assert.ok(alternative.text.includes("better than it looked"), alternative.text);
assert.ok(alternative.text.includes("—"), "quoted-printable UTF-8 decodes");
assert.ok(alternative.html.includes("<i>See the third one"), alternative.html);
assert.strictEqual(alternative.attachments.length, 0);

// Base64 body, and a subject encoded in it too.
const base64 = parseMessage(read("base64"));
assert.ok(base64.subject.startsWith("Salut de Paris"), base64.subject);
assert.ok(base64.text.includes("Le café est cher"), base64.text);

// Latin-1, which is where a naive parser gives up.
const latin1 = parseMessage(read("latin1"));
assert.strictEqual(latin1.subject, "Grüße aus Wien");
assert.ok(latin1.text.includes("ausgezeichnet"), latin1.text);
assert.ok(latin1.text.includes("Grüße"), latin1.text);

// An attachment is named and measured, not inlined.
const withFile = parseMessage(read("attachment"));
assert.strictEqual(withFile.attachments.length, 1);
assert.strictEqual(withFile.attachments[0].name, "invoice.pdf");
assert.strictEqual(withFile.attachments[0].type, "application/pdf");
assert.ok(withFile.attachments[0].size > 0);
assert.ok(withFile.text.includes("Due at the end"), withFile.text);

// HTML with no text part at all.
const htmlOnly = parseMessage(read("html-only"));
assert.strictEqual(htmlOnly.text, "");
assert.ok(htmlOnly.html.includes("<h1>This week</h1>"), htmlOnly.html);

// A thread holds together by what each message answers.
const reply = parseMessage(read("thread-3"));
assert.strictEqual(reply.inReplyTo, "re:-the-grid-idea@example.net");
assert.deepStrictEqual(reply.references, ["re:-the-grid-idea@example.net"]);
assert.strictEqual(threadSubject(reply.subject), "the grid idea");
