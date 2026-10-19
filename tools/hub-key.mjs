/**
 * The key a phrase makes, for talking to the hub with curl.
 *
 * The phrase never crosses the network: both ends hash it and the hub
 * compares hashes, so debugging by hand needs the hash rather than the
 * phrase. This prints it, and the two requests worth making.
 *
 *   node tools/hub-key.mjs "two blue herons" [address]
 */
import { createHash } from "node:crypto";

const phrase = (process.argv[2] ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const address = process.argv[3] ?? "10.0.0.71:8777";
if (!phrase) {
	console.error('usage: node tools/hub-key.mjs "the phrase" [host:port]');
	process.exit(1);
}

const key = createHash("sha256").update(`skybox hub/${phrase}`).digest("hex");
console.log(`key: ${key}\n`);
console.log(`curl -s -H "x-skybox-key: ${key}" http://${address}/skybox`);
console.log(`curl -s -H "x-skybox-key: ${key}" http://${address}/manifest`);
