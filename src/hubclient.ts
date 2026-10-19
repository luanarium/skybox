import { Notice, TFile, normalizePath, requestUrl, type App, type Plugin } from "obsidian";
import type { VaultIndex } from "./index";
import { readPhrase } from "./hub";
import {
	HUB_KEY_HEADER,
	hex,
	hubFolders,
	hubUrl,
	phraseKey,
	pullPlan,
	pullSentence,
	withinServed,
	type HubManifest,
	type PullPlan,
} from "./sync";
import type { SkyboxSettings } from "./types";
import { guarded } from "./writes";

/**
 * The asking half, which any device can be.
 *
 * `requestUrl` is Obsidian's own request, handled outside the web view, so it
 * works the same on a phone as on a computer and asks nothing of CORS. What
 * it does with what comes back is deliberately timid in this first pass: it
 * writes files this vault does not have, it replaces files this vault has not
 * touched since the last time the two agreed, and it leaves everything else
 * exactly where it is. The agreed hashes are what make the second of those
 * safe, and they are kept beside the plugin rather than in the vault, because
 * they describe this device's own state and should never travel.
 */

/** What both ends last agreed on, by hub vault name and then by path. */
type Agreed = Record<string, Record<string, string>>;

export class HubPull {
	private agreed: Agreed = {};
	private loaded = false;
	private running = false;

	constructor(
		private app: App,
		private settings: SkyboxSettings,
		private index: VaultIndex,
		private plugin: Plugin
	) {}

	/** Ask the hub what it holds, take what is safe to take. */
	async sync(aloud = false): Promise<void> {
		if (this.running) return;
		const address = this.settings.hubAddress.trim();
		const phrase = readPhrase(this.app);
		if (!address || !phrase) {
			if (aloud) {
				new Notice(
					address
						? "Skybox needs the hub's phrase, the same one typed on the computer."
						: "Skybox needs the hub's address before it can ask it anything."
				);
			}
			return;
		}

		this.running = true;
		try {
			const key = await phraseKey(phrase);
			const manifest = await this.ask<HubManifest>(address, "/manifest", key);
			if (!manifest) return;
			await this.load();

			const folders = hubFolders(this.settings);
			const agreed = new Map(Object.entries(this.agreed[manifest.vault] ?? {}));
			const offered = manifest.files.filter((entry) => withinServed(entry.path, folders));
			const local = await this.localHashes(folders, offered.map((entry) => entry.path));
			const plan = pullPlan(local, offered, agreed);

			const [taken, trouble] = await this.take(address, key, plan, agreed);

			// Everything the two sides now hold identically is a baseline for
			// next time, which is what tells somebody's edit from a stale copy.
			for (const entry of offered) {
				if (agreed.get(entry.path) !== entry.hash && local.get(entry.path) === entry.hash) {
					agreed.set(entry.path, entry.hash);
				}
			}
			this.agreed[manifest.vault] = Object.fromEntries(agreed);
			await this.save();

			if (aloud || taken > 0 || trouble > 0) {
				new Notice(`Skybox: ${pullSentence(plan, taken, trouble)}`);
			}
		} catch (error) {
			console.error("Skybox: the hub pull failed", error);
			if (aloud) {
				new Notice(
					`Skybox could not reach the hub: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		} finally {
			this.running = false;
		}
	}

	/** Who is answering, for the Check button: the hub's vault, or nothing. */
	async greet(): Promise<string> {
		const address = this.settings.hubAddress.trim();
		const phrase = readPhrase(this.app);
		if (!address) return "There is no address to ask.";
		if (!phrase) return "There is no phrase yet, so the hub would not answer.";
		const key = await phraseKey(phrase);
		const url = hubUrl(address, this.settings.hubPort, "/skybox");
		const answer = await requestUrl({
			url,
			method: "GET",
			headers: { [HUB_KEY_HEADER]: key },
			throw: false,
		});
		if (answer.status === 401) return "Something answered, but the phrase does not match it.";
		if (answer.status !== 200) return `Answered with status ${answer.status}.`;
		const said = answer.json as HubManifest;
		return `Answering: the vault "${said.vault}".`;
	}

	private async ask<T>(address: string, path: string, key: string): Promise<T | null> {
		const url = hubUrl(address, this.settings.hubPort, path);
		if (!url) {
			new Notice("Skybox cannot make an address out of that.");
			return null;
		}
		const answer = await requestUrl({
			url,
			method: "GET",
			headers: { [HUB_KEY_HEADER]: key },
			throw: false,
		});
		if (answer.status === 401) {
			new Notice("Skybox: the hub did not recognise that phrase.");
			return null;
		}
		if (answer.status !== 200) {
			new Notice(`Skybox: the hub answered with status ${answer.status}.`);
			return null;
		}
		return answer.json as T;
	}

	/** Fetch what the plan asks for, and say how it went. */
	private async take(
		address: string,
		key: string,
		plan: PullPlan,
		agreed: Map<string, string>
	): Promise<[number, number]> {
		let taken = 0;
		let trouble = 0;
		for (const step of plan.fetch) {
			const url = `${hubUrl(address, this.settings.hubPort, "/file")}?path=${encodeURIComponent(step.path)}`;
			try {
				const answer = await requestUrl({
					url,
					method: "GET",
					headers: { [HUB_KEY_HEADER]: key },
					throw: false,
				});
				if (answer.status !== 200) {
					trouble++;
					continue;
				}
				const bytes = answer.arrayBuffer;
				const got = hex(await crypto.subtle.digest("SHA-256", bytes));
				if (got !== step.hash) {
					// What arrived is not what was offered, so it is not written.
					console.error("Skybox: hash mismatch pulling", step.path, got, step.hash);
					trouble++;
					continue;
				}
				await this.write(step.path, bytes);
				agreed.set(step.path, step.hash);
				taken++;
			} catch (error) {
				console.error("Skybox: could not pull", step.path, error);
				trouble++;
			}
		}
		return [taken, trouble];
	}

	/**
	 * Writing the file, under the plugin's own write flag so share intake
	 * does not mistake an arriving file for something the user just shared.
	 */
	private async write(path: string, bytes: ArrayBuffer): Promise<void> {
		const clean = normalizePath(path);
		await guarded(async () => {
			await this.mkdirs(clean);
			const existing = this.app.vault.getAbstractFileByPath(clean);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, bytes);
				this.index.ensure(existing);
				return;
			}
			const made = await this.app.vault.createBinary(clean, bytes);
			this.index.ensure(made);
		});
	}

	private async mkdirs(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let walked = "";
		for (const part of parts) {
			walked = walked ? `${walked}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(walked))) {
				await this.app.vault.adapter.mkdir(walked);
			}
		}
	}

	/** The hashes of what is here now, for the paths that matter. */
	private async localHashes(folders: string[], offered: string[]): Promise<Map<string, string>> {
		const wanted = new Set(offered);
		const hashes = new Map<string, string>();
		for (const file of this.app.vault.getFiles()) {
			if (!wanted.has(file.path) && !withinServed(file.path, folders)) continue;
			const bytes = await this.app.vault.readBinary(file);
			hashes.set(file.path, hex(await crypto.subtle.digest("SHA-256", bytes)));
		}
		return hashes;
	}

	/*
	 * The agreed hashes are this device's own memory of the last sync, so
	 * they live beside the plugin rather than in the vault: a file in the
	 * vault would sync, and a device's memory of what it had agreed is
	 * exactly the thing that must not arrive from somewhere else.
	 */
	private statePath(): string {
		const dir = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/skybox`;
		return normalizePath(`${dir}/hub-state.json`);
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const path = this.statePath();
			if (!(await this.app.vault.adapter.exists(path))) return;
			const said = JSON.parse(await this.app.vault.adapter.read(path)) as Agreed;
			if (said && typeof said === "object") this.agreed = said;
		} catch (error) {
			console.error("Skybox: could not read what the hub and this device agreed", error);
		}
	}

	private async save(): Promise<void> {
		try {
			await this.app.vault.adapter.write(
				this.statePath(),
				JSON.stringify(this.agreed, null, "\t")
			);
		} catch (error) {
			console.error("Skybox: could not keep what the hub and this device agreed", error);
		}
	}
}
