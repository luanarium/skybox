import * as assert from "node:assert";
import { isKind, kindsOf } from "../src/kinds";

// A video is a video however its address is written.
assert.deepStrictEqual(kindsOf("https://www.youtube.com/watch?v=jQNeYbBiCKw"), ["video"]);
assert.deepStrictEqual(kindsOf("https://youtu.be/jQNeYbBiCKw"), ["video"]);
assert.deepStrictEqual(kindsOf("https://m.youtube.com/shorts/abc"), ["video"]);
assert.deepStrictEqual(kindsOf("https://www.youtube.com/@someone"), ["video"], "a channel too");
assert.deepStrictEqual(kindsOf("https://vimeo.com/123"), ["video"]);
assert.deepStrictEqual(kindsOf("https://www.twitch.tv/someone"), ["video"]);

// A host can be two things at once, and says both.
assert.deepStrictEqual(
	kindsOf("https://music.youtube.com/watch?v=abc"),
	["video", "music"],
	"music on a video host is both"
);
assert.deepStrictEqual(kindsOf("https://artist.bandcamp.com/album/one"), ["music"]);
assert.deepStrictEqual(kindsOf("https://soundcloud.com/someone/a-track"), ["music"]);

// The rest of the table, by the shape of the matching rather than every host.
assert.deepStrictEqual(kindsOf("https://github.com/st3w/neo"), ["code"]);
assert.deepStrictEqual(kindsOf("https://old.reddit.com/r/linux"), ["social"], "under the host");
assert.deepStrictEqual(kindsOf("https://www.ebay.co.uk/itm/123"), ["shop"]);
assert.deepStrictEqual(kindsOf("https://en.wikipedia.org/wiki/Ninja"), ["wiki"]);
assert.deepStrictEqual(kindsOf("https://news.ycombinator.com/item?id=1"), ["read"]);

// And what has no kind: a personal site is just a page.
assert.deepStrictEqual(kindsOf("https://pixelmoondust.neocities.org/archives"), []);
assert.deepStrictEqual(kindsOf("https://notyoutube.com/watch?v=abc"), [], "not a lookalike");
assert.deepStrictEqual(kindsOf("https://youtube.com.evil.example/watch"), [], "nor a prefix of one");
assert.deepStrictEqual(kindsOf("file:///home/neo/a.mp4"), [], "not an address worth reading");
assert.deepStrictEqual(kindsOf(""), []);
assert.deepStrictEqual(kindsOf(undefined), []);
assert.deepStrictEqual(kindsOf(42), []);

// Reading a chip.
assert.ok(isKind("video"));
assert.ok(isKind("VIDEO"));
assert.ok(!isKind("videos"));
assert.ok(!isKind("watch?"));
assert.ok(!isKind(""));
