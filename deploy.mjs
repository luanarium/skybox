/**
 * Copies what Obsidian loads — `main.js`, `manifest.json`, `styles.css` —
 * into a folder named `skybox`, ready to be dropped into a vault's
 * `.obsidian/plugins/`. Build first; this only copies.
 *
 *   npm run deploy                      # into ./dist/skybox
 *   SKYBOX_DEST=~/somewhere npm run deploy
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const FILES = ["main.js", "manifest.json", "styles.css"];

const asked = process.argv[2] ?? process.env.SKYBOX_DEST ?? "dist";
const base = resolve(asked.startsWith("~") ? join(homedir(), asked.slice(1)) : asked);
// The folder Obsidian reads has to be the plugin's own name.
const target = base.endsWith("/skybox") ? base : join(base, "skybox");

mkdirSync(target, { recursive: true });
for (const file of FILES) {
	statSync(file);
	copyFileSync(file, join(target, file));
}

console.log(`copied ${FILES.join(", ")} into ${target}`);
