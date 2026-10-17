import * as assert from "node:assert";
import { isIgnored, parseIgnored } from "../src/ignore";

// One per line or comma-separated, with slashes and blanks tidied away.
assert.deepStrictEqual(parseIgnored("attachments\ntemplates"), ["attachments", "templates"]);
assert.deepStrictEqual(parseIgnored("attachments, templates"), ["attachments", "templates"]);
assert.deepStrictEqual(parseIgnored("/attachments/"), ["attachments"]);
assert.deepStrictEqual(parseIgnored("  \n\n  "), []);
assert.deepStrictEqual(parseIgnored(""), []);
assert.deepStrictEqual(parseIgnored("notes/old\nnotes/old/"), ["notes/old"]);
assert.deepStrictEqual(parseIgnored("Attachments\nattachments"), ["attachments"]);

const ignored = parseIgnored("attachments\nknowledge_base_backup\nnotes/old");

// The folder itself, anything under it, however deep.
assert.ok(isIgnored("attachments/photo.png", ignored));
assert.ok(isIgnored("attachments/2026/march/photo.png", ignored));
assert.ok(isIgnored("attachments/photo.png.md", ignored));
assert.ok(isIgnored("knowledge_base_backup/Kyoto, three days.md", ignored));
assert.ok(isIgnored("notes/old/draft.md", ignored));
// Case folded, since the box is typed by hand.
assert.ok(isIgnored("Attachments/Photo.png", ignored));

// And nothing else — in particular not a folder that merely starts the same.
assert.ok(!isIgnored("attachments.md", ignored));
assert.ok(!isIgnored("attachments-2026/photo.png", ignored));
assert.ok(!isIgnored("notes/older/draft.md", ignored));
assert.ok(!isIgnored("notes/old.md", ignored));
assert.ok(!isIgnored("inbox/photo.png", ignored));
assert.ok(!isIgnored("Kyoto, three days.md", ignored));

// Nothing listed, nothing ignored.
assert.ok(!isIgnored("attachments/photo.png", []));
