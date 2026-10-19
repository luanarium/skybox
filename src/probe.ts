import { Platform, requestUrl } from "obsidian";

/**
 * Asking whether a local address can be reached from here.
 *
 * This is a probe rather than a feature. A hub inside the plugin, with the
 * phone pulling from the desktop over the network they share, stands or falls
 * on one unknown: Android has refused cleartext HTTP by default since Android
 * 9, and whether that reaches inside Obsidian is reported both ways. So the
 * question is asked twice, because the two routes out of a plugin are not the
 * same route. `requestUrl` is Obsidian's own, handled natively, subject to the
 * app's network policy and nothing else. `fetch` is the web view's, subject to
 * mixed-content rules and to CORS. Either one being enough is enough.
 */

export interface Reach {
	route: "requestUrl" | "fetch";
	ok: boolean;
	detail: string;
}

/** Both routes, tried in order, each reported whatever the other did. */
export async function reachable(address: string): Promise<Reach[]> {
	const url = normalizeAddress(address);
	if (!url) return [];
	return [await viaRequestUrl(url), await viaFetch(url)];
}

/** What to show for it: one line, the good news first if there is any. */
export function reachSentence(tries: Reach[]): string {
	if (tries.length === 0) return "That is not an address Skybox can try.";
	const won = tries.filter((one) => one.ok);
	if (won.length === tries.length) return `Both routes answered. ${tries[0].detail}`;
	if (won.length > 0) {
		const lost = tries.find((one) => !one.ok);
		return `${won[0].route} answered, ${lost?.route} did not. ${won[0].detail} ${lost?.detail}`;
	}
	return `Nothing answered. ${tries.map((one) => `${one.route}: ${one.detail}`).join(" ")}`;
}

/** A host, a host and port, or a whole address, as an address. */
export function normalizeAddress(value: string): string {
	const text = value.trim();
	if (!text) return "";
	const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
	try {
		const url = new URL(withScheme);
		if (!url.hostname) return "";
		return url.toString();
	} catch {
		return "";
	}
}

async function viaRequestUrl(url: string): Promise<Reach> {
	try {
		const answer = await requestUrl({ url, method: "GET", throw: false });
		return {
			route: "requestUrl",
			ok: answer.status > 0 && answer.status < 400,
			detail: `status ${answer.status}, ${answer.arrayBuffer.byteLength} bytes.`,
		};
	} catch (error) {
		return { route: "requestUrl", ok: false, detail: `${reason(error)}.` };
	}
}

async function viaFetch(url: string): Promise<Reach> {
	try {
		const answer = await fetch(url, { method: "GET" });
		const body = await answer.arrayBuffer();
		return {
			route: "fetch",
			ok: answer.ok,
			detail: `status ${answer.status}, ${body.byteLength} bytes.`,
		};
	} catch (error) {
		return { route: "fetch", ok: false, detail: `${reason(error)}.` };
	}
}

/**
 * What went wrong, in the words it came in. The wording is the evidence here:
 * a refused connection is a network that does not reach, while cleartext not
 * permitted is a policy, and only the second one would end the idea.
 */
function reason(error: unknown): string {
	const said = error instanceof Error ? error.message : String(error);
	return said || (Platform.isMobile ? "refused with nothing said" : "failed with nothing said");
}
