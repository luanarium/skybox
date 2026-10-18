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
