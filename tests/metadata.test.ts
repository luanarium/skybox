import * as assert from "node:assert";
import {
	absoluteUrl,
	decodeEntities,
	hasMeta,
	parseMetadata,
	readDate,
} from "../src/metadata";

const PAGE = `
<!doctype html>
<html>
<head>
	<title>Chicken soup &mdash; Wikipedia</title>
	<meta charset="utf-8">
	<meta property="og:title" content="Chicken soup">
	<meta property="og:description" content="A soup made from chicken &amp; broth.">
	<meta property="og:image" content="/images/soup.png">
	<meta property="og:site_name" content="Wikipedia">
	<meta name="author" content="Many hands">
	<meta property="article:published_time" content="2024-03-02T11:00:00Z">
	<!-- <meta property="og:title" content="A comment, not a page"> -->
</head>
<body><p>Soup.</p></body>
</html>`;

const meta = parseMetadata(PAGE, "https://en.wikipedia.org/wiki/Chicken_soup");

assert.strictEqual(meta.title, "Chicken soup", "Open Graph wins over the title tag");
assert.strictEqual(meta.description, "A soup made from chicken & broth.", "entities decoded");
assert.strictEqual(meta.image, "https://en.wikipedia.org/images/soup.png", "image made absolute");
assert.strictEqual(meta.site, "Wikipedia");
assert.strictEqual(meta.author, "Many hands");
assert.strictEqual(meta.published, "2024-03-02");
assert.ok(hasMeta(meta));

// A page that declares nothing still gives up its title, and nothing else.
const bare = parseMetadata("<html><head><title> Just a page </title></head></html>", "https://x.dev/a");
assert.strictEqual(bare.title, "Just a page");
assert.strictEqual(bare.description, null);
assert.strictEqual(bare.image, null);
assert.ok(!hasMeta(bare), "a title alone is not metadata worth writing down");

// Single quotes, odd attribute order, and uppercase tags are all ordinary HTML.
const scruffy = parseMetadata(
	`<META CONTENT='Hello' PROPERTY='og:description'><meta content=bare name=author>`,
	"https://x.dev/"
);
assert.strictEqual(scruffy.description, "Hello");
assert.strictEqual(scruffy.author, "bare");

// Nothing at all is not a crash.
assert.deepStrictEqual(parseMetadata("", "https://x.dev/").title, null);
assert.ok(!hasMeta(parseMetadata("", "https://x.dev/")));

// Image URLs come in every shape.
const base = "https://site.com/blog/post?x=1";
assert.strictEqual(absoluteUrl("https://cdn.site.com/a.png", base), "https://cdn.site.com/a.png");
assert.strictEqual(absoluteUrl("//cdn.site.com/a.png", base), "https://cdn.site.com/a.png");
assert.strictEqual(absoluteUrl("/a.png", base), "https://site.com/a.png");
assert.strictEqual(absoluteUrl("a.png", base), "https://site.com/blog/a.png");
assert.strictEqual(absoluteUrl(null, base), null);
assert.strictEqual(absoluteUrl("", base), null);

// Dates are only kept when they can be read.
assert.strictEqual(readDate("2024-03-02T11:00:00Z"), "2024-03-02");
assert.strictEqual(readDate("March 2, 2024"), "2024-03-02");
assert.strictEqual(readDate("sometime last spring"), null);
assert.strictEqual(readDate(null), null);

// Entities, named and numeric.
assert.strictEqual(decodeEntities("a &amp; b"), "a & b");
assert.strictEqual(decodeEntities("it&#39;s"), "it's");
assert.strictEqual(decodeEntities("it&#x27;s"), "it's");
assert.strictEqual(decodeEntities("&unknown;"), "&unknown;");
