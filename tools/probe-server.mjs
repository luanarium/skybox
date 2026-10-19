/**
 * A throwaway stand-in for the hub, to answer one question: can Obsidian on a
 * phone reach a plain HTTP address on the local network at all?
 *
 * Android has refused cleartext traffic by default since Android 9, and the
 * reports from other plugins disagree about what that means inside Obsidian.
 * Nothing about a real hub is worth writing until this is settled, so this
 * server does the least it can: it answers everything with a little JSON, it
 * sends permissive CORS headers so a failure cannot be blamed on them, and it
 * prints who asked, which is how you tell an Obsidian request from the phone's
 * browser trying the same address.
 *
 *   node tools/probe-server.mjs            # port 8777
 *   node tools/probe-server.mjs 9000
 *
 * Then put http://<this machine's address>:8777/ into Skybox's settings, under
 * Local hub, and press Check on the phone.
 */
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const port = Number(process.argv[2] ?? 8777);

const server = createServer((request, response) => {
	const from = request.socket.remoteAddress ?? "somewhere";
	const agent = request.headers["user-agent"] ?? "no user agent";
	console.log(`${new Date().toLocaleTimeString()}  ${request.method} ${request.url}  ${from}`);
	console.log(`                 ${agent}`);

	response.writeHead(200, {
		"content-type": "application/json",
		"access-control-allow-origin": "*",
		"access-control-allow-headers": "*",
		"access-control-allow-methods": "GET, PUT, POST, OPTIONS, PROPFIND",
	});
	response.end(
		JSON.stringify({
			ok: true,
			said: "the hub would answer here",
			at: new Date().toISOString(),
			you: from,
		})
	);
});

server.listen(port, "0.0.0.0", () => {
	console.log(`probe listening on port ${port}. Addresses to try from the phone:`);
	for (const [name, addresses] of Object.entries(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal) {
				console.log(`  http://${address.address}:${port}/   (${name})`);
			}
		}
	}
	console.log("Ctrl+C to stop.");
});
