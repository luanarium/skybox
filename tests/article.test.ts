import * as assert from "node:assert";
import { ARTICLE_HEADING, hasArticle, withArticle } from "../src/article";

const note = `---
title: A page
source: https://example.com/a
---

# A page

<https://example.com/a>

A description the page gave for itself.
`;

const article = { markdown: "## First heading\n\nThe article itself.", words: 4 };
const filled = withArticle(note, article);

// The article goes last, under its own heading, with what was there kept.
assert.ok(filled.startsWith(note.trimEnd()), "nothing above it is disturbed");
assert.ok(filled.includes(`\n\n${ARTICLE_HEADING}\n\n## First heading`), filled);
assert.ok(filled.trimEnd().endsWith("The article itself."), filled);
assert.ok(hasArticle(filled));
assert.ok(!hasArticle(note));

// A note that already holds the page's text is left exactly as it is: the
// copy in the vault may have been edited, and the page may have changed.
assert.strictEqual(withArticle(filled, { markdown: "Something else", words: 2 }), filled);

// A note someone has written their own thoughts into keeps them first.
const annotated = `${note}\nMy own thoughts on this.\n`;
const both = withArticle(annotated, article);
assert.ok(both.indexOf("My own thoughts") < both.indexOf(ARTICLE_HEADING), both);

// A card's excerpt stops at the article and never shows markup: the page's
// own description is what should be read at a glance.
import { plainExcerpt } from "../src/search";

const bookmark = `---
title: A page
source: https://example.com/a
---

# A page

<https://example.com/a>

The description the page gave for itself.

${ARTICLE_HEADING}

## A heading in the article

The article itself, which is for searching rather than for the card.
`;

const excerpt = plainExcerpt(bookmark);
assert.strictEqual(excerpt, "A page The description the page gave for itself.", excerpt);
assert.ok(!excerpt.includes("https://"), excerpt);
assert.ok(!excerpt.includes("article itself"), excerpt);

// And an article that came in as HTML before this was fixed still reads as
// words rather than as tags.
const htmlish = plainExcerpt("Before.\n\n<div class=\"x\"><img src=\"a.png\"><p>After.</p></div>");
assert.strictEqual(htmlish, "Before. After.", htmlish);

// A `cover` property points at a file however it was written.
import { coverLink, coverTarget, sameCover, webImage } from "../src/preview";

assert.strictEqual(coverTarget("[[shots/a.png]]"), "shots/a.png");
assert.strictEqual(coverTarget("![[a.png]]"), "a.png");
assert.strictEqual(coverTarget("[[a.png|thumb]]"), "a.png");
assert.strictEqual(coverTarget("[[a.png#top]]"), "a.png");
assert.strictEqual(coverTarget("a.png"), "a.png");
assert.strictEqual(coverTarget('"a.png"'), "a.png");
assert.strictEqual(coverTarget("https://x.dev/a.png"), null, "a web address is not a vault file");
assert.strictEqual(coverTarget(""), null);
assert.strictEqual(coverTarget(undefined), null);

assert.strictEqual(coverLink("shots/a.png"), "[[shots/a.png]]");

// Matching tolerates the short form a link may have been written in.
assert.ok(sameCover("[[shots/a.png]]", "shots/a.png"));
assert.ok(sameCover("[[a.png]]", "shots/a.png"));
assert.ok(!sameCover("[[b.png]]", "shots/a.png"));
assert.ok(!sameCover(undefined, "shots/a.png"));

assert.strictEqual(webImage("https://x.dev/a.png"), "https://x.dev/a.png");
assert.strictEqual(webImage("a.png"), null);
