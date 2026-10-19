import * as assert from "node:assert";
import { bodyImage, coverLink, coverTarget, sameCover, webImage } from "../src/preview";

// Only an address is drawn as itself.
assert.strictEqual(webImage(" https://host/a.jpg "), "https://host/a.jpg");
assert.strictEqual(webImage("HTTP://host/a.jpg"), "HTTP://host/a.jpg");
assert.strictEqual(webImage("host/a.jpg"), null);
assert.strictEqual(webImage("file:///home/a.jpg"), null, "not a thing to put in a card");
assert.strictEqual(webImage(42), null);

// A cover property, however somebody wrote it.
assert.strictEqual(coverTarget("![[pictures/a.png]]"), "pictures/a.png");
assert.strictEqual(coverTarget("[[a.png|small]]"), "a.png");
assert.strictEqual(coverTarget('"a.png"'), "a.png");
assert.strictEqual(coverTarget("https://host/a.jpg"), null, "an address is not a file");
assert.strictEqual(coverTarget(""), null);
assert.strictEqual(coverLink("pictures/a.png"), "[[pictures/a.png]]");
assert.ok(sameCover("[[a.png]]", "pictures/a.png"), "a name finds the file it names");
assert.ok(sameCover("[[pictures/a.png]]", "pictures/a.png"));
assert.ok(!sameCover("[[b.png]]", "pictures/a.png"));

// A picture somebody wrote into a note, which is the one its card should show.
assert.strictEqual(
	bodyImage("# A page\n\n![](https://host/pretty.gif)\n"),
	"https://host/pretty.gif"
);
assert.strictEqual(bodyImage("![[pictures/a.png]]"), "pictures/a.png");
assert.strictEqual(bodyImage("![[a.png|300]]"), "a.png", "a size is not part of the name");
assert.strictEqual(bodyImage("![alt text](a.png)"), "a.png");
assert.strictEqual(bodyImage("![](<my pictures/a b.png>)"), "my pictures/a b.png");
assert.strictEqual(bodyImage('![](a.png "titled")'), "a.png");
assert.strictEqual(bodyImage("![](https://host/thumb?id=7)"), "https://host/thumb?id=7");

// The first one, whichever way it was written.
assert.strictEqual(
	bodyImage("![](https://host/first.png)\n\n![[second.png]]\n"),
	"https://host/first.png"
);
assert.strictEqual(
	bodyImage("![[first.png]]\n\n![](https://host/second.png)\n"),
	"first.png"
);

// Not a picture, and not somebody's own text.
assert.strictEqual(bodyImage("[[a.png]]"), null, "a link is not an embed");
assert.strictEqual(bodyImage("[a link](https://host/page)"), null);
assert.strictEqual(bodyImage("![[another note]]"), null, "an embedded note draws nothing");
assert.strictEqual(bodyImage("![[a.pdf]]"), null);
assert.strictEqual(bodyImage(""), null);
assert.strictEqual(
	bodyImage("---\nimage: https://host/offered.jpg\ncover: a.png\n---\n\n# A page\n"),
	null,
	"properties are read elsewhere, with their own order"
);
assert.strictEqual(
	bodyImage("---\ntitle: A\n---\n\n![](https://host/mine.gif)\n"),
	"https://host/mine.gif",
	"and the text after them is still the text"
);
assert.strictEqual(
	bodyImage("# A page\n\n```md\n![](https://host/example.png)\n```\n"),
	null,
	"an example of how to write one is not one"
);
assert.strictEqual(
	bodyImage("## Page text\n\n![](https://host/logo.png)\n"),
	null,
	"the pictures in an article arrived with it; nobody chose them"
);
assert.strictEqual(
	bodyImage("![](https://host/mine.gif)\n\n## Page text\n\n![](https://host/logo.png)\n"),
	"https://host/mine.gif",
	"what somebody added above the article still counts"
);
