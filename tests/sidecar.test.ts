import * as assert from "node:assert";
import { splitFrontMatter } from "../src/sidecar";
import { isImageExtension, sidecarPathFor, sidecarTargetPath } from "../src/types";

assert.strictEqual(sidecarTargetPath("shots/foo.png.md"), "shots/foo.png", "a sidecar names its image");
assert.strictEqual(sidecarTargetPath("shots/foo.md"), null, "an ordinary note is not a sidecar");
assert.strictEqual(sidecarTargetPath("shots/foo.png"), null, "an image is not a sidecar");
assert.strictEqual(sidecarTargetPath("foo.pdf.md"), null, "only images have sidecars");
assert.strictEqual(sidecarPathFor("a/b.jpg"), "a/b.jpg.md");
assert.ok(isImageExtension("JPEG"), "the extension is matched whatever its case");
assert.ok(!isImageExtension("txt"));

const note = "---\ntags: [x]\nhash: abc\n---\nbody line\nmore\n";
assert.deepStrictEqual(
	splitFrontMatter(note),
	{ matter: "---\ntags: [x]\nhash: abc\n---\n", body: "body line\nmore\n" },
	"frontmatter and body come apart at the closing fence"
);
assert.deepStrictEqual(
	splitFrontMatter("no matter\n"),
	{ matter: "", body: "no matter\n" },
	"a note without frontmatter is all body"
);
