/**
 * Runs every `tests/*.test.ts` under node: esbuild bundles each one with the
 * `obsidian` import pointed at the stub, and a file that throws fails.
 *
 * Obsidian itself cannot be driven from a shell, so these cover the modules
 * that do not need a workspace. Everything about views, transitions and window
 * chrome still has to be looked at in the real app.
 */
import esbuild from "esbuild";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const tests = readdirSync(here)
	.filter((name) => name.endsWith(".test.ts"))
	.sort();

if (tests.length === 0) {
	console.error("no tests found in tests/");
	process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "telegrid-tests-"));

await esbuild.build({
	entryPoints: tests.map((name) => join(here, name)),
	outdir: out,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	alias: { obsidian: join(here, "obsidian-stub.ts") },
	logLevel: "warning",
});

let failed = 0;
for (const name of tests) {
	try {
		await import(pathToFileURL(join(out, `${basename(name, ".ts")}.js`)).href);
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed++;
		console.error(`fail  ${name}\n${error?.stack ?? error}`);
	}
}

console.log(`\n${tests.length - failed} of ${tests.length} passed`);
process.exit(failed ? 1 : 0);
