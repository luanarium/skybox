import * as assert from "node:assert";
import { embedUrl, videoId, watchUrl } from "../src/video";

// However the address was written.
assert.strictEqual(videoId("https://www.youtube.com/watch?v=jQNeYbBiCKw"), "jQNeYbBiCKw");
assert.strictEqual(
	videoId("https://www.youtube.com/watch?v=jQNeYbBiCKw&t=42s&list=PL123"),
	"jQNeYbBiCKw",
	"a time and a playlist are still that video"
);
assert.strictEqual(videoId("https://youtu.be/jQNeYbBiCKw?si=abc"), "jQNeYbBiCKw");
assert.strictEqual(videoId("https://m.youtube.com/watch?v=jQNeYbBiCKw"), "jQNeYbBiCKw");
assert.strictEqual(videoId("https://www.youtube.com/shorts/jQNeYbBiCKw"), "jQNeYbBiCKw");
assert.strictEqual(videoId("https://www.youtube.com/live/jQNeYbBiCKw"), "jQNeYbBiCKw");
assert.strictEqual(videoId("https://www.youtube-nocookie.com/embed/jQNeYbBiCKw"), "jQNeYbBiCKw");
assert.strictEqual(videoId("  https://youtube.com/watch?v=jQNeYbBiCKw  "), "jQNeYbBiCKw");

// And what is not a video.
assert.strictEqual(videoId("https://www.youtube.com/@someone"), null, "a channel is not a video");
assert.strictEqual(
	videoId("https://www.youtube.com/playlist?list=PL123"),
	null,
	"a playlist is not a video"
);
assert.strictEqual(videoId("https://www.youtube.com/watch?v=short"), null, "not an id");
assert.strictEqual(videoId("https://vimeo.com/123456"), null, "another service, another day");
assert.strictEqual(videoId("https://pixelmoondust.neocities.org/"), null);
assert.strictEqual(videoId("not a url at all"), null);
assert.strictEqual(videoId(""), null);
assert.strictEqual(videoId(undefined), null);
assert.strictEqual(videoId(42), null);

// Where the player comes from, and where the page is.
assert.strictEqual(
	embedUrl("jQNeYbBiCKw"),
	"https://www.youtube-nocookie.com/embed/jQNeYbBiCKw?rel=0"
);
assert.strictEqual(watchUrl("jQNeYbBiCKw"), "https://www.youtube.com/watch?v=jQNeYbBiCKw");
