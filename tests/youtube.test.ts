import * as assert from "node:assert";
import { commentToken, comments, initialData, topComments, watchPage } from "../src/youtube";

// The page ships its whole UI as one JSON object in a script tag. Finding the
// end of it means counting braces, because a comment can hold one.
const data: Record<string, unknown> = {
	contents: {
		twoColumnWatchNextResults: {
			results: {
				results: {
					contents: [
						{ videoPrimaryInfoRenderer: { title: "a video" } },
						{
							itemSectionRenderer: {
								sectionIdentifier: "comment-item-section",
								contents: [
									{
										continuationItemRenderer: {
											continuationEndpoint: {
												continuationCommand: { token: "TOKEN-123", request: "x" },
											},
										},
									},
								],
							},
						},
					],
				},
			},
		},
	},
};
const html =
	'<script>var ytInitialData = ' +
	JSON.stringify(data) +
	';</script><script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaSy-test_key","INNERTUBE_CLIENT_VERSION":"2.20260101.00.00"});</script>';

assert.deepStrictEqual(initialData(html), data, "read back whole");
assert.deepStrictEqual(
	initialData('var ytInitialData = {"text":"a } brace in a string"};'),
	{ text: "a } brace in a string" },
	"a brace inside a string does not close the object"
);
assert.deepStrictEqual(
	initialData('var ytInitialData = {"text":"a } brace \\" in a string"};'),
	{ text: 'a } brace " in a string' },
	"a brace or a quote inside a string does not close the object"
);
assert.strictEqual(initialData("<html>nothing here</html>"), null);

/*
 * The page a phone is served writes the same object as a quoted string with
 * every brace and quote hex-escaped. It is legal JavaScript and unreadable
 * JSON until it is unescaped, and reading only the plain form is why comments
 * loaded on a computer and not on a phone.
 */
const escaped = JSON.stringify(data)
	.replace(/\{/g, "\\x7b")
	.replace(/\}/g, "\\x7d")
	.replace(/\[/g, "\\x5b")
	.replace(/\]/g, "\\x5d")
	.replace(/"/g, "\\x22");
const phoneHtml =
	`<script>var ytInitialData = '${escaped}';</script>` +
	'<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaSy-test_key",' +
	'"INNERTUBE_CONTEXT_CLIENT_NAME":2,"INNERTUBE_CLIENT_VERSION":"2.20260101.01.00"});</script>';

assert.deepStrictEqual(initialData(phoneHtml), data, "unescaped back to the same object");
assert.deepStrictEqual(
	initialData(`var ytInitialData = '\\x7b\\x22a\\x22:\\x22one\\\\ntwo\\x22\\x7d';`),
	{ a: "one\ntwo" },
	"a newline inside the text is still a newline"
);
assert.deepStrictEqual(
	initialData(`var ytInitialData = '\\x7b\\x22a\\x22:\\x22it\\'s\\x22\\x7d';`),
	{ a: "it's" },
	"an escaped quote is the quote"
);
assert.strictEqual(
	initialData(`var ytInitialData = '\\x7b\\x22a\\x22:1`),
	null,
	"a literal with no end is nothing"
);

const phone = watchPage(phoneHtml);
assert.strictEqual(phone?.token, "TOKEN-123", "the same token, read out of the escaped page");
assert.strictEqual(phone?.clientName, "MWEB", "and asked for as the client that was served");
assert.strictEqual(phone?.clientVersion, "2.20260101.01.00");

const page = watchPage(html);
assert.strictEqual(page?.key, "AIzaSy-test_key");
assert.strictEqual(page?.clientName, "WEB", "a computer is served the web page");
assert.strictEqual(page?.clientVersion, "2.20260101.00.00");
assert.strictEqual(page?.token, "TOKEN-123", "the token is found by its section, not its place");
assert.strictEqual(watchPage("<html>a consent page</html>"), null, "nothing to ask with");

// The token is found by the section naming itself, so other continuations in
// the page are not mistaken for the comments.
assert.strictEqual(
	commentToken({
		contents: [
			{ itemSectionRenderer: { sectionIdentifier: "related-items", contents: [{ continuationCommand: { token: "WRONG" } }] } },
			{ itemSectionRenderer: { sectionIdentifier: "comment-item-section", contents: [{ continuationCommand: { token: "RIGHT" } }] } },
		],
	}),
	"RIGHT"
);
assert.strictEqual(commentToken({ contents: [] }), null);
assert.strictEqual(commentToken(null), null);

// The shape YouTube serves now: a view model beside a batch of entities.
const modern = {
	frameworkUpdates: {
		entityBatchUpdate: {
			mutations: [
				{
					payload: {
						commentEntityPayload: {
							key: "Ug-key-1",
							properties: {
								commentId: "Ug-key-1",
								content: { content: "First thing anybody said." },
								publishedTime: "3 years ago",
								pinnedText: "Pinned by Someone",
							},
							author: {
								displayName: "@a_person",
								avatarThumbnailUrl: "https://yt3.ggpht.com/a",
							},
							toolbar: { likeCountNotliked: "1.2K", replyCount: "14" },
						},
					},
				},
				{
					payload: {
						commentEntityPayload: {
							key: "Ug-key-2",
							properties: { content: { content: "Second." }, publishedTime: "1 month ago" },
							author: { displayName: "@another" },
							toolbar: { likeCountNotliked: "3" },
						},
					},
				},
				{ payload: { someOtherEntity: { key: "x" } } },
			],
		},
	},
};
const read = comments(modern);
assert.strictEqual(read.length, 2, "the payloads that are comments, and nothing else");
assert.deepStrictEqual(read[0], {
	id: "Ug-key-1",
	author: "@a_person",
	handle: "a_person",
	avatar: "https://yt3.ggpht.com/a",
	when: "3 years ago",
	text: "First thing anybody said.",
	likes: "1.2K",
	pinned: true,
	replies: 14,
});
assert.strictEqual(read[1].pinned, false);
assert.strictEqual(read[1].replies, 0);
assert.strictEqual(read[1].avatar, null);

// The shape before it, which some answers still carry.
const older = {
	onResponseReceivedEndpoints: [
		{
			reloadContinuationItemsCommand: {
				continuationItems: [
					{
						commentThreadRenderer: {
							comment: {
								commentRenderer: {
									commentId: "UgOld",
									contentText: { runs: [{ text: "Half " }, { text: "a line." }] },
									authorText: { simpleText: "@someone_else" },
									authorThumbnail: {
										thumbnails: [
											{ url: "https://yt3.ggpht.com/small" },
											{ url: "https://yt3.ggpht.com/large" },
										],
									},
									publishedTimeText: { simpleText: "2 days ago" },
									voteCount: { simpleText: "7" },
									replyCount: 2,
								},
							},
						},
					},
				],
			},
		},
	],
};
const back = comments(older);
assert.strictEqual(back.length, 1);
assert.strictEqual(back[0].text, "Half a line.", "runs are one line of text");
assert.strictEqual(back[0].author, "@someone_else");
assert.strictEqual(back[0].avatar, "https://yt3.ggpht.com/large", "the biggest one offered");
assert.strictEqual(back[0].likes, "7");
assert.strictEqual(back[0].replies, 2);

// Five is five, and a shape nobody recognises is nothing rather than wrong.
const many = {
	mutations: Array.from({ length: 9 }, (_, at) => ({
		payload: {
			commentEntityPayload: {
				key: `k${at}`,
				properties: { content: { content: `number ${at}` } },
				author: { displayName: "@who" },
			},
		},
	})),
};
assert.strictEqual(comments(many).length, 5, "the top five");
assert.strictEqual(comments(many, 2).length, 2);
assert.deepStrictEqual(comments({ something: "else" }), []);
assert.deepStrictEqual(comments(null), []);

// The two requests, with a stand-in for Obsidian's fetch: the page for the
// token and the key it carries, then the endpoint its own scripts call.
{
	const asked: string[] = [];
	const found = await topComments(async (options) => {
		asked.push(`${options.method ?? "GET"} ${options.url}`);
		if (options.url.includes("/watch")) return { status: 200, text: html };
		assert.ok(options.body?.includes("TOKEN-123"), "the token the page gave us");
		assert.ok(options.url.includes("AIzaSy-test_key"), "the key the page carries");
		assert.ok(options.body?.includes('"clientName":"WEB"'), "asked for as the page it read");
		return { status: 200, text: JSON.stringify(modern) };
	}, "jQNeYbBiCKw");
	assert.strictEqual(found.comments.length, 2);
	assert.strictEqual(found.why, "");
	assert.strictEqual(asked.length, 2, "one page, one endpoint");
	assert.ok(asked[0].includes("bpctr=9999999999"), "past the consent page");
	assert.ok(asked[1].startsWith("POST "), "the endpoint is a post");
}

// Every way it can come to nothing says which way it was.
{
	const refused = await topComments(async () => ({ status: 429, text: "" }), "jQNeYbBiCKw");
	assert.deepStrictEqual(refused.comments, []);
	assert.match(refused.why, /429/);

	const strange = await topComments(async () => ({ status: 200, text: "<html>hello</html>" }), "x");
	assert.match(strange.why, /not the one YouTube usually serves/);

	const noComments = await topComments(
		async () => ({
			status: 200,
			text: 'var ytInitialData = {"contents":[]};"INNERTUBE_API_KEY":"AIzaSy-k"',
		}),
		"x"
	);
	assert.match(noComments.why, /turned off, or there are none/);

	// The console line this one writes is the point of it, not a surprise.
	const said = console.error;
	console.error = () => {};
	const broke = await topComments(async () => {
		throw new Error("no network");
	}, "x");
	console.error = said;
	assert.deepStrictEqual(broke.comments, []);
	assert.match(broke.why, /could not be read/);
}

// A phone reads the escaped page, and the answer it gets back for MWEB is the
// older renderer shape rather than the entity payloads, which is why both are
// read rather than only the newest.
{
	const found = await topComments(async (options) => {
		if (options.url.includes("/watch")) return { status: 200, text: phoneHtml };
		assert.ok(options.body?.includes('"clientName":"MWEB"'), "the client it was served");
		return { status: 200, text: JSON.stringify(older) };
	}, "jQNeYbBiCKw");
	assert.strictEqual(found.comments.length, 1);
	assert.strictEqual(found.comments[0].text, "Half a line.");
}
