import * as assert from "node:assert";
import {
	MAIL_TAG,
	lastId,
	parseThreadNote,
	sameParty,
	sortThreads,
	threadFileName,
	threadNote,
	type Thread,
} from "../src/thread";
import { assemble, composeMail, htmlToPlain, replyHeaders } from "../src/mail";
import { subjectOf } from "../src/dm";
import { cleanHtml } from "../src/components/MailOverlay";

const thread: Thread = {
	id: "root@example.net",
	source: "mail",
	subject: "Lunch on Thursday?",
	with: "Marion <marion@example.org>",
	unread: true,
	messages: [
		{ id: "root@example.net", who: "Marion <marion@example.org>", at: Date.parse("2026-10-17T10:00:00Z"), text: "Are you free?", mine: false },
		{ id: "mine@example.net", who: "neo <neo@example.net>", at: Date.parse("2026-10-17T11:00:00Z"), text: "I am.\n\nWhere?", mine: true },
	],
};

// A thread note says what it is, and reads back as what it was.
const note = threadNote(thread);
assert.ok(note.includes("thread_id: root@example.net"), note);
assert.ok(note.includes("thread_source: mail"), note);
assert.ok(note.includes("unread: true"), note);
assert.ok(note.includes(`  - ${MAIL_TAG}`), note);
assert.ok(note.includes('subject: "Lunch on Thursday?"'), "a subject with a ? is quoted");

const read = parseThreadNote(note, "neo@example.net");
assert.strictEqual(read.length, 2);
assert.strictEqual(read[0].who, "Marion <marion@example.org>");
assert.strictEqual(read[0].text, "Are you free?");
assert.ok(!read[0].mine);
assert.strictEqual(read[1].text, "I am.\n\nWhere?", "a message keeps its own blank lines");
assert.ok(read[1].mine, "yours is yours however your address was written");

// One person, written two ways.
assert.ok(sameParty("Marion <marion@example.org>", "marion@example.org"));
assert.ok(sameParty("@someone", "someone"));
assert.ok(!sameParty("a@b", "c@d"));
assert.ok(!sameParty("", "a@b"));

// A filename a vault will take.
assert.strictEqual(threadFileName(thread), "Lunch on Thursday.md");
assert.strictEqual(threadFileName({ ...thread, subject: "a/b: c" }), "a b c.md");
assert.strictEqual(threadFileName({ ...thread, subject: "" }), "conversation.md");

// What is waiting comes first, then what happened last.
const older = { ...thread, id: "b", unread: false };
const sorted = sortThreads([older, thread]);
assert.deepStrictEqual(sorted.map((each) => each.id), ["root@example.net", "b"]);

// Messages group into conversations by what answers what.
const message = (id: string, inReplyTo: string | null, date: number, from: string) => ({
	id,
	inReplyTo,
	references: inReplyTo ? [inReplyTo] : [],
	subject: inReplyTo ? "Re: the grid idea" : "the grid idea",
	from: { name: "", address: from },
	to: [{ name: "", address: "neo@example.net" }],
	date,
	text: `said by ${from}`,
	html: "",
	attachments: [],
});

const threads = assemble(
	[
		message("a@x", null, 1000, "ada@example.org"),
		message("b@x", "a@x", 2000, "neo@example.net"),
		message("c@x", "b@x", 3000, "ada@example.org"),
		message("solo@x", null, 4000, "someone@example.org"),
	],
	"neo@example.net"
);
assert.strictEqual(threads.length, 2, "a reply to a reply stays in one thread");
const main = threads.find((each) => each.id === "a@x");
assert.ok(main);
assert.strictEqual(main.messages.length, 3);
assert.strictEqual(main.subject, "the grid idea", "the Re: comes off");
assert.strictEqual(main.with, "ada@example.org", "the other party is whoever is not you");
assert.ok(main.messages[1].mine);

// HTML mail reads as words.
assert.strictEqual(htmlToPlain("<p>One</p><p>Two</p>"), "One\n\nTwo");
assert.strictEqual(htmlToPlain("a<br>b"), "a\nb");
assert.strictEqual(htmlToPlain("<ul><li>x</li><li>y</li></ul>"), "- x\n\n- y");
assert.strictEqual(htmlToPlain("<style>p{}</style><p>only</p>"), "only");

// A reply answers the last message and keeps the subject.
const headers = replyHeaders(thread, "neo@example.net", "mine@example.net");
assert.strictEqual(headers.Subject, "Re: Lunch on Thursday?");
assert.strictEqual(headers.To, "Marion <marion@example.org>");
assert.strictEqual(headers["In-Reply-To"], "<mine@example.net>");
assert.strictEqual(replyHeaders({ ...thread, subject: "Re: already" }, "x", "").Subject, "Re: already");

// What goes in the outbox is a message a transfer agent will take.
const raw = composeMail(headers, "plain words", "<p>plain <i>words</i></p>");
assert.ok(raw.includes("Subject: Re: Lunch on Thursday?\r\n"), raw.slice(0, 200));
assert.ok(raw.includes('Content-Type: multipart/alternative; boundary="skybox-'), raw.slice(0, 400));
assert.ok(raw.includes("text/plain; charset=utf-8"), raw);
assert.ok(raw.includes("<p>plain <i>words</i></p>"), raw);
assert.ok(raw.trimEnd().endsWith("--"), "the envelope is closed");

// A direct message has no subject, so its first words become one.
assert.strictEqual(subjectOf("@someone are you about?"), "are you about?");
assert.strictEqual(subjectOf(""), "(no subject)");
assert.ok(subjectOf("x".repeat(90)).endsWith("…"));

// A composer may carry emphasis into mail, and nothing else.
assert.strictEqual(cleanHtml("<p>a <i>b</i></p>"), "<p>a <i>b</i></p>");
assert.strictEqual(cleanHtml('<p class="x">a</p>'), "<p>a</p>");
assert.strictEqual(cleanHtml("<script>bad()</script>a"), "bad()a");
assert.strictEqual(cleanHtml('<img src=x onerror="bad()">a'), "a");
assert.strictEqual(cleanHtml("<div>a</div>"), "<p>a</p>");

// A reply needs the id of what it answers, which the note carries because
// the messages in its body do not.
assert.strictEqual(lastId(thread), "mine@example.net");
assert.strictEqual(lastId({ ...thread, messages: [] }), "");
assert.ok(threadNote(thread).includes("thread_last: mine@example.net"), "the note says what to answer");

// Outgoing mail carries an id of its own, so an answer to it threads too.
const mine = replyHeaders(thread, "neo@example.net", "mine@example.net");
assert.ok(/^<\d+\.[a-z0-9]+@example\.net>$/.test(mine["Message-ID"]), mine["Message-ID"]);
assert.notStrictEqual(
	replyHeaders(thread, "neo@example.net", "x")["Message-ID"],
	mine["Message-ID"],
	"each message gets its own"
);
