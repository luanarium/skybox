import * as assert from "node:assert";
import {
	clock,
	embedUrl,
	listenMessage,
	playerMessage,
	playerState,
	playerUrl,
	videoId,
	watchUrl,
} from "../src/video";

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

// The skinned player drives the embed by posting messages at it, with no
// library and nothing loaded from Google to do it.
assert.strictEqual(
	playerUrl("jQNeYbBiCKw"),
	"https://www.youtube-nocookie.com/embed/jQNeYbBiCKw?rel=0&enablejsapi=1&playsinline=1"
);
assert.deepStrictEqual(JSON.parse(playerMessage("playVideo")), {
	event: "command",
	func: "playVideo",
	args: [],
	id: 1,
	channel: "widget",
});
assert.deepStrictEqual(JSON.parse(playerMessage("seekTo", [42, true])).args, [42, true]);
assert.strictEqual(JSON.parse(listenMessage()).event, "listening");

// What it says back, where it says anything.
assert.deepStrictEqual(
	playerState(JSON.stringify({ event: "infoDelivery", info: { currentTime: 12.5, duration: 300, playerState: 1 } })),
	{ at: 12.5, length: 300, playing: true }
);
assert.deepStrictEqual(
	playerState(JSON.stringify({ event: "infoDelivery", info: { playerState: 2 } })),
	{ at: null, length: null, playing: false },
	"paused, and nothing said about where"
);
assert.deepStrictEqual(
	playerState(JSON.stringify({ event: "infoDelivery", info: { currentTime: 3 } })),
	{ at: 3, length: null, playing: null },
	"a position with no word on whether it is moving"
);
assert.strictEqual(
	playerState(JSON.stringify({ event: "infoDelivery", info: { volume: 50 } })),
	null,
	"nothing the display can use"
);
assert.strictEqual(playerState(JSON.stringify({ event: "apiInfoDelivery" })), null);
assert.strictEqual(playerState("not json at all"), null);
assert.strictEqual(playerState(JSON.stringify({ event: "infoDelivery", info: { duration: 0 } })), null);
assert.strictEqual(playerState(42), null);

// The time, as a player shows it.
assert.strictEqual(clock(0), "00:00");
assert.strictEqual(clock(9), "00:09");
assert.strictEqual(clock(42.7), "00:42");
assert.strictEqual(clock(600), "10:00");
assert.strictEqual(clock(3599), "59:59");
assert.strictEqual(clock(5999), "99:59", "minutes as far as a player counts them");
assert.strictEqual(clock(6000), "1:40:00", "and past that it grows an hour");
assert.strictEqual(clock(36000), "10:00:00");
assert.strictEqual(clock(null), "--:--", "nothing is not zero");
assert.strictEqual(clock(-1), "--:--");
assert.strictEqual(clock(Number.NaN), "--:--");
