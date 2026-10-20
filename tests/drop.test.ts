import * as assert from "node:assert";
import {
	draggedPicture,
	pictureExtension,
	pictureLink,
	pictureName,
	placePicture,
	type Dragged,
} from "../src/drop";

const nothing: Dragged = { uriList: "", html: "", text: "" };

// A picture dragged off a page carries its address, in one of three ways.
assert.strictEqual(
	draggedPicture({ ...nothing, uriList: "https://host/a.gif" }),
	"https://host/a.gif"
);
assert.strictEqual(
	draggedPicture({ ...nothing, uriList: "# a comment\r\nhttps://host/a.gif\r\n" }),
	"https://host/a.gif",
	"a uri-list comment is not an address"
);
assert.strictEqual(
	draggedPicture({
		...nothing,
		html: '<a href="https://host/page"><img alt="x" src="https://host/a.gif?w=2&amp;h=3"></a>',
	}),
	"https://host/a.gif?w=2&h=3",
	"the tag says where the picture is, and its src is HTML"
);
assert.strictEqual(
	draggedPicture({ ...nothing, html: "<img src='https://host/a.gif'>" }),
	"https://host/a.gif"
);
assert.strictEqual(
	draggedPicture({ ...nothing, html: "<img src=https://host/a.gif >" }),
	"https://host/a.gif",
	"unquoted, as plenty of pages write it"
);
assert.strictEqual(draggedPicture({ ...nothing, text: " https://host/a.gif " }), "https://host/a.gif");

// The address is preferred over the page it was linked to.
assert.strictEqual(
	draggedPicture({
		uriList: "https://host/a.gif",
		html: '<img src="https://other/b.gif">',
		text: "https://host/page",
	}),
	"https://host/a.gif"
);

// Nothing worth fetching.
assert.strictEqual(draggedPicture(nothing), null);
assert.strictEqual(draggedPicture({ ...nothing, text: "some words I dragged" }), null);
assert.strictEqual(
	draggedPicture({ ...nothing, text: "https://host/a.gif and more words" }),
	null,
	"a sentence with an address in it is not a picture"
);
assert.strictEqual(
	draggedPicture({ ...nothing, uriList: "file:///home/neo/a.gif" }),
	null,
	"a local file arrives as a file, not as an address to fetch"
);
assert.strictEqual(
	draggedPicture({ ...nothing, uriList: "data:image/gif;base64,R0lGOD" }),
	null
);

// What the host says it is sending.
assert.strictEqual(pictureExtension("image/gif"), "gif");
assert.strictEqual(pictureExtension("IMAGE/JPEG; charset=binary"), "jpg");
assert.strictEqual(pictureExtension("image/svg+xml"), "svg");
assert.strictEqual(pictureExtension("text/html"), null, "a page is not a picture");
assert.strictEqual(pictureExtension(""), null);

// What it is called once it is a file.
assert.strictEqual(pictureName("https://host/pretty.gif", "gif"), "pretty.gif");
assert.strictEqual(
	pictureName("https://file.garden/x/archived%20backgrounds/bgblueorbs.gif", "gif"),
	"bgblueorbs.gif",
	"the name the page gave it, unescaped"
);
assert.strictEqual(
	pictureName("https://host/pretty.gif?v=2#top", "gif"),
	"pretty.gif",
	"a query is not part of a name"
);
assert.strictEqual(
	pictureName("https://i.ytimg.com/vi/abc/maxresdefault", "jpg"),
	"maxresdefault.jpg",
	"no extension in the address, so the host's word for it"
);
assert.strictEqual(pictureName("https://host/thumb?id=7", "png"), "thumb.png");
assert.strictEqual(pictureName("https://host/", "png"), "picture.png", "nothing to go on");
assert.strictEqual(
	pictureName("https://host/a:b*c?d", "png"),
	"a b c.png",
	"a filename cannot hold those"
);
assert.strictEqual(
	pictureName("https://host/a.PNG", "jpg"),
	"a.png",
	"its own name, with the kind in lower case as every other file here has it"
);

// Where it goes in a note.
assert.strictEqual(pictureLink("skybox/a.gif"), "![[skybox/a.gif]]");
assert.strictEqual(
	placePicture("---\ntitle: A\n---\n\n# A\n\n<https://host/page>\n", "![[a.gif]]"),
	"---\ntitle: A\n---\n\n# A\n\n<https://host/page>\n\n![[a.gif]]\n"
);
assert.strictEqual(
	placePicture("# A\n\n<https://host/page>\n\n## Page text\n\nThe article.\n", "![[a.gif]]"),
	"# A\n\n<https://host/page>\n\n![[a.gif]]\n\n## Page text\n\nThe article.\n",
	"above the article, which is the part somebody wrote"
);
assert.strictEqual(placePicture("", "![[a.gif]]"), "![[a.gif]]\n");
assert.strictEqual(
	placePicture("---\ntitle: A\n---\n", "![[a.gif]]"),
	"---\ntitle: A\n---\n\n![[a.gif]]\n",
	"a note with nothing but properties still has a body to write into"
);
