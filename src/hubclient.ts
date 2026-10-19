import { Notice, TFile, normalizePath, requestUrl, type App, type Plugin } from "obsidian";
import type { VaultIndex } from "./index";
import { readPhrase } from "./hub";
import { review } from "./review";
import {
	HUB_BASE_HEADER,
	HUB_KEY_HEADER,
	hex,
	hubFolders,
	hubUrl,
	phraseKey,
	pullPlan,
	reviewSentence,
	syncSentence,
	withinServed,
	type HubManifest,
	type GoneStep,
	type PullPlan,
	type SyncTally,
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
	private reviewing = false;

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

			const tally: SyncTally = { taken: 0, sent: 0, asked: 0, trouble: 0 };
			await this.take(address, key, plan, agreed, tally);
			await this.send(address, key, plan, agreed, tally);
			await this.sendGone(address, key, plan, agreed, tally);

			// Everything the two sides now hold identically is a baseline for
			// next time, which is what tells somebody's edit from a stale copy.
			for (const entry of offered) {
				if (agreed.get(entry.path) !== entry.hash && local.get(entry.path) === entry.hash) {
					agreed.set(entry.path, entry.hash);
				}
			}
			for (const path of plan.forget) agreed.delete(path);
			this.agreed[manifest.vault] = Object.fromEntries(agreed);
			await this.save();

			// Asking is a window, which outlives the sync that opened it.
			if (plan.gone.length > 0) void this.reviewGone(manifest.vault, plan.gone);

			if (aloud || tally.taken > 0 || tally.sent > 0 || tally.trouble > 0) {
				new Notice(`Skybox: ${syncSentence(plan, tally)}`);
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
		agreed: Map<string, string>,
		tally: SyncTally
	): Promise<void> {
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
					tally.trouble++;
					continue;
				}
				const bytes = answer.arrayBuffer;
				const got = hex(await crypto.subtle.digest("SHA-256", bytes));
				if (got !== step.hash) {
					// What arrived is not what was offered, so it is not written.
					console.error("Skybox: hash mismatch pulling", step.path, got, step.hash);
					tally.trouble++;
					continue;
				}
				await this.write(step.path, bytes);
				agreed.set(step.path, step.hash);
				tally.taken++;
			} catch (error) {
				console.error("Skybox: could not pull", step.path, error);
				tally.trouble++;
			}
		}
	}

	/**
	 * Sending what this device has and the hub has not.
	 *
	 * Every change goes up with the hash the two sides last agreed on, and
	 * the hub applies it only if that is still what it holds. So a change
	 * that would land on top of somebody else's work comes back refused
	 * instead, and the next sync sees it as a collision like any other. A
	 * refusal is not an error: it is the protocol working.
	 */
	private async send(
		address: string,
		key: string,
		plan: PullPlan,
		agreed: Map<string, string>,
		tally: SyncTally
	): Promise<void> {
		for (const step of plan.ours) {
			const file = this.app.vault.getAbstractFileByPath(step.path);
			if (!(file instanceof TFile)) continue;
			const url = `${hubUrl(address, this.settings.hubPort, "/file")}?path=${encodeURIComponent(step.path)}`;
			try {
				const bytes = await this.app.vault.readBinary(file);
				// Read again rather than trusting the hash from the plan: the
				// file may have been typed into since, and sending bytes under
				// a hash that is not theirs is the one thing the hub cannot
				// check for us.
				const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
				const answer = await requestUrl({
					url,
					method: "PUT",
					headers: {
						[HUB_KEY_HEADER]: key,
						[HUB_BASE_HEADER]: step.base ?? "",
						"content-type": "application/octet-stream",
					},
					body: bytes,
					throw: false,
				});
				if (answer.status === 200) {
					agreed.set(step.path, hash);
					tally.sent++;
					continue;
				}
				if (answer.status === 403) {
					// The hub is not taking changes at all, so neither is the
					// rest of this list, and saying so once is enough.
					new Notice(
						"Skybox: the hub is not taking changes. Switch on " +
							'"Take changes from your devices" on the computer that serves.',
						15000
					);
					return;
				}
				if (answer.status !== 409) {
					console.error("Skybox: the hub refused", step.path, answer.status);
				}
			} catch (error) {
				console.error("Skybox: could not send", step.path, error);
			}
		}
	}

	/**
	 * Telling the hub about a file deleted here.
	 *
	 * The hub does not act on it. It puts the request in front of whoever is
	 * at that computer, and the answer comes back on a later sync: the file
	 * stops being offered, or the hub says it kept it. Keeping is final, and
	 * the right response to it here is to let the file come back, so the
	 * baseline is dropped and the next sync treats it as new.
	 */
	private async sendGone(
		address: string,
		key: string,
		plan: PullPlan,
		agreed: Map<string, string>,
		tally: SyncTally
	): Promise<void> {
		for (const step of plan.sendGone) {
			const url = `${hubUrl(address, this.settings.hubPort, "/file")}?path=${encodeURIComponent(step.path)}`;
			try {
				const answer = await requestUrl({
					url,
					method: "DELETE",
					headers: { [HUB_KEY_HEADER]: key, [HUB_BASE_HEADER]: step.base },
					throw: false,
				});
				if (answer.status === 200) {
					// Gone there already, so there is nothing left to agree on.
					agreed.delete(step.path);
					continue;
				}
				if (answer.status === 202) {
					tally.asked++;
					continue;
				}
				const said = (answer.json as { error?: string } | undefined)?.error;
				if (answer.status === 409 && said === "kept") {
					agreed.delete(step.path);
					new Notice(
						`Skybox: the hub is keeping ${name(step.path)}, so it comes back here.`,
						15000
					);
					continue;
				}
				console.error("Skybox: the hub would not drop", step.path, answer.status, said);
			} catch (error) {
				console.error("Skybox: could not ask the hub to drop", step.path, error);
			}
		}
	}

	/**
	 * Reading what the hub deleted, in front of somebody.
	 *
	 * This outlives the sync that opened it, so the baselines it touches are
	 * saved on its own. Keeping a file drops its baseline too: the file is
	 * then something this device has and the hub does not, which is exactly
	 * what it is, and the next sync offers it back.
	 */
	private async reviewGone(vault: string, gone: GoneStep[]): Promise<void> {
		if (this.reviewing) return;
		this.reviewing = true;
		try {
			const keeping = await review(this.app, {
				title: "Deleted on the hub",
				message:
					`${gone.length === 1 ? "This was" : `These ${gone.length} were`} deleted ` +
					"on the computer that serves the hub. Switch on anything you want to " +
					"keep here, and it goes back to the hub instead. The rest go to the " +
					"trash. Closing this window keeps the lot.",
				items: gone.map((step) => step.path),
				confirm: "Apply",
			});

			await this.load();
			const agreed = new Map(Object.entries(this.agreed[vault] ?? {}));
			let removed = 0;
			for (const step of gone) {
				// Either way this baseline has nothing left to describe: the
				// file is on its way to the trash, or it is ours to offer.
				agreed.delete(step.path);
				if (keeping.has(step.path)) continue;
				const file = this.app.vault.getAbstractFileByPath(step.path);
				if (file) await this.app.fileManager.trashFile(file);
				removed++;
			}
			this.agreed[vault] = Object.fromEntries(agreed);
			await this.save();
			new Notice(`Skybox: ${reviewSentence(removed, keeping.size)}`);
		} catch (error) {
			console.error("Skybox: the review went wrong", error);
		} finally {
			this.reviewing = false;
		}
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

function name(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
