import { Notice, TFile, normalizePath, requestUrl, type App, type Plugin } from "obsidian";
import type { VaultIndex } from "./index";
import { readPhrase } from "./hub";
import { merge3 } from "./merge";
import { review } from "./review";
import {
	HUB_BASE_HEADER,
	HUB_KEY_HEADER,
	hex,
	hubFolders,
	hubUrl,
	phraseKey,
	pullPlan,
	megabytes,
	strayPictures,
	tooHeavy,
	reviewSentence,
	syncSentence,
	withinServed,
	type HubManifest,
	type GoneStep,
	type PullPlan,
	type SyncTally,
} from "./sync";
import { COLLISION_TAG, type SkyboxSettings } from "./types";
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
	/**
	 * The text of the notes read while hashing, kept for the length of one
	 * sync so a merge does not read the whole vault again.
	 */
	private text = new Map<string, string>();
	/**
	 * What each served file hashed to, by the time and size it had then.
	 * Lives as long as the session: a hash is cheap to recompute and
	 * nothing here is worth writing to disk.
	 */
	private hashes = new Map<
		string,
		{ mtime: number; size: number; hash: string; text: string | null }
	>();

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
			// A file crosses whole, through memory on both sides, so what is
			// past the limit is left where it is rather than stalling the sync
			// with nothing said.
			const most = Math.max(0, this.settings.hubMostMB) * 1024 * 1024;
			const sizes = new Map(offered.map((entry) => [entry.path, entry.size]));
			for (const file of this.app.vault.getFiles()) {
				if (withinServed(file.path, folders)) sizes.set(file.path, file.stat.size);
			}
			const heavy = new Set(
				tooHeavy(
					sizes,
					[...plan.fetch, ...plan.ours].map((step) => step.path),
					most
				)
			);
			for (const path of heavy) {
				console.error(
					"Skybox: too large to carry across the hub",
					path,
					megabytes(sizes.get(path) ?? 0)
				);
			}
			plan.fetch = plan.fetch.filter((step) => !heavy.has(step.path));
			plan.ours = plan.ours.filter((step) => !heavy.has(step.path));

			const tally: SyncTally = {
				taken: 0,
				sent: 0,
				asked: 0,
				merged: 0,
				split: 0,
				trouble: 0,
				heavy: heavy.size,
				// A picture outside the served folders cannot travel with the
				// note that holds it, and this is the only moment anybody is
				// told. The hub says the same thing beside its own switch.
				stray: strayPictures(
					this.index.pictures((note) => withinServed(note, folders)),
					folders
				).length,
			};
			await this.take(address, key, plan, agreed, tally);
			await this.send(address, key, plan, agreed, tally);
			await this.sendGone(address, key, plan, agreed, tally);
			await this.reconcile(address, key, manifest.vault, plan, agreed, tally);

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
			await this.keepBases(agreed);

			// Asking is a window, which outlives the sync that opened it.
			if (plan.gone.length > 0) void this.reviewGone(manifest.vault, plan.gone);

			if (
				aloud ||
				tally.taken > 0 ||
				tally.sent > 0 ||
				tally.merged > 0 ||
				tally.split > 0 ||
				tally.trouble > 0
			) {
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
			this.text.clear();
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

	/**
	 * The hashes of what is here now, for the paths that matter.
	 *
	 * Kept by modified time and size, the way the serving side keeps its
	 * own: a vault where nothing changed costs a stat per file rather than a
	 * read, which matters the moment a served folder holds a photograph or a
	 * track rather than only notes.
	 */
	private async localHashes(folders: string[], offered: string[]): Promise<Map<string, string>> {
		const wanted = new Set(offered);
		const hashes = new Map<string, string>();
		for (const file of this.app.vault.getFiles()) {
			if (!wanted.has(file.path) && !withinServed(file.path, folders)) continue;
			const known = this.hashes.get(file.path);
			if (known && known.mtime === file.stat.mtime && known.size === file.stat.size) {
				hashes.set(file.path, known.hash);
				if (known.text !== null) this.text.set(file.path, known.text);
				continue;
			}
			const bytes = await this.app.vault.readBinary(file);
			const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
			hashes.set(file.path, hash);
			// Kept in passing: a merge needs the text, and reading it here
			// costs nothing because the bytes are already in hand.
			const said = mergeable(file.path, bytes);
			if (said !== null) this.text.set(file.path, said);
			this.hashes.set(file.path, {
				mtime: file.stat.mtime,
				size: file.stat.size,
				hash,
				text: said,
			});
		}
		// A file that has gone stops being remembered.
		for (const path of [...this.hashes.keys()]) {
			if (!hashes.has(path)) this.hashes.delete(path);
		}
		return hashes;
	}

	/**
	 * Files both sides have moved on from, which is the one case a sync has
	 * to think about.
	 *
	 * Two edits to the same note are usually two edits to different parts of
	 * it, and those go back together: the baseline says what both sides
	 * started from, so an edit at the top and an edit at the bottom are
	 * plainly independent. Where the same lines were typed into twice there
	 * is no answer, and inventing one would be the one mistake this cannot
	 * take back, so both versions are kept as two files and the finding of
	 * them is made easy instead.
	 */
	private async reconcile(
		address: string,
		key: string,
		vault: string,
		plan: PullPlan,
		agreed: Map<string, string>,
		tally: SyncTally
	): Promise<void> {
		for (const clash of plan.collided) {
			// A deletion against an edit is not a merge: the edit survives
			// where it was made, which the plan has already decided.
			if (!clash.base || !clash.mine || !clash.theirs) continue;
			const file = this.app.vault.getAbstractFileByPath(clash.path);
			if (!(file instanceof TFile)) continue;

			const mine = this.text.get(clash.path);
			const base = await this.baseText(clash.base);
			if (mine === undefined || base === null) continue;

			const bytes = await this.fetch(address, key, clash.path, clash.theirs);
			if (!bytes) {
				tally.trouble++;
				continue;
			}
			const theirs = mergeable(clash.path, bytes);
			if (theirs === null) continue;

			const merged = merge3(base, mine, theirs);
			if (merged.ok) {
				// Both devices end up with the same text, and the hub is
				// handed it under the hash it still holds, so it can refuse
				// if something arrived there in the meantime.
				const text = merged.text;
				const kept = await this.push(address, key, clash.path, bytes2(text), clash.theirs);
				if (!kept) {
					tally.trouble++;
					continue;
				}
				// Typed into since it was read? Then that is newer than the
				// merge, it stands, and the next sync carries it up.
				await guarded(() =>
					this.app.vault.process(file, (current) => (current === mine ? text : current))
				);
				this.index.ensure(file);
				agreed.set(clash.path, await hashOf(text));
				tally.merged++;
				continue;
			}

			// No merge, so nothing is lost instead: their copy is written
			// beside ours, tagged so that one chip finds every one of them.
			const copy = await this.diverge(clash.path, vault, theirs);
			if (!copy) {
				tally.trouble++;
				continue;
			}
			// Ours stays where it is, and the hub is given it, so both
			// devices hold both versions and neither has lost an argument.
			const ours = await this.push(
				address,
				key,
				clash.path,
				await this.app.vault.readBinary(file),
				clash.theirs
			);
			if (!ours) {
				/*
				 * The hub's copy moved on between reading the manifest and
				 * now, so this was not the collision it looked like. The copy
				 * just written goes again rather than being left to pile up
				 * another one on the next attempt: it is seconds old, nobody
				 * has seen it, and the version it holds is still on the hub.
				 */
				await guarded(() => this.app.vault.delete(copy));
				tally.trouble++;
				continue;
			}
			agreed.set(clash.path, clash.mine);
			tally.split++;
			new Notice(
				`Skybox: ${name(clash.path)} was edited on both devices. Both versions are ` +
					`here, and #${COLLISION_TAG} finds the other one.`,
				15000
			);
		}
	}

	/**
	 * Their version, written beside ours rather than over it.
	 *
	 * It carries the path it came from and the collision tag, so the chip
	 * finds it and the card says what it belongs to. Reconciling is then
	 * reading two cards and deleting one, which is a thing a person can do
	 * and a thing software should not do on its own.
	 */
	private async diverge(path: string, vault: string, theirs: string): Promise<TFile | null> {
		const dot = path.lastIndexOf(".");
		const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
		const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
		let taken = `${stem} (from ${vault})${extension}`;
		for (let at = 2; this.app.vault.getAbstractFileByPath(taken); at++) {
			taken = `${stem} (from ${vault} ${at})${extension}`;
		}
		try {
			let made: TFile | null = null;
			await guarded(async () => {
				made = await this.app.vault.create(taken, theirs);
				this.index.ensure(made);
			});
			if (!made) return null;
			await guarded(() =>
				this.app.fileManager.processFrontMatter(made as TFile, (front) => {
					front.collision_of = path;
					const tags = Array.isArray(front.tags)
						? front.tags.map(String)
						: typeof front.tags === "string"
							? front.tags.split(/\s+/).filter(Boolean)
							: [];
					if (!tags.includes(COLLISION_TAG)) tags.push(COLLISION_TAG);
					front.tags = tags;
				})
			);
			this.index.ensure(made);
			return made;
		} catch (error) {
			console.error("Skybox: could not keep the other version of", path, error);
			return null;
		}
	}

	/** One file from the hub, checked against the hash it was offered under. */
	private async fetch(
		address: string,
		key: string,
		path: string,
		hash: string
	): Promise<ArrayBuffer | null> {
		try {
			const url = `${hubUrl(address, this.settings.hubPort, "/file")}?path=${encodeURIComponent(path)}`;
			const answer = await requestUrl({
				url,
				method: "GET",
				headers: { [HUB_KEY_HEADER]: key },
				throw: false,
			});
			if (answer.status !== 200) return null;
			const bytes = answer.arrayBuffer;
			if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== hash) return null;
			return bytes;
		} catch (error) {
			console.error("Skybox: could not read", path, "from the hub", error);
			return null;
		}
	}

	/** One file to the hub, under the hash it is expected to be holding. */
	private async push(
		address: string,
		key: string,
		path: string,
		bytes: ArrayBuffer,
		base: string
	): Promise<boolean> {
		try {
			const url = `${hubUrl(address, this.settings.hubPort, "/file")}?path=${encodeURIComponent(path)}`;
			const answer = await requestUrl({
				url,
				method: "PUT",
				headers: {
					[HUB_KEY_HEADER]: key,
					[HUB_BASE_HEADER]: base,
					"content-type": "application/octet-stream",
				},
				body: bytes,
				throw: false,
			});
			return answer.status === 200;
		} catch (error) {
			console.error("Skybox: could not hand", path, "to the hub", error);
			return false;
		}
	}

	/*
	 * The content baselines: a copy of what both sides last agreed on, which
	 * is what a merge needs and a hash cannot give. They are kept beside the
	 * plugin, named by their own hash, so the hashes already in `agreed` say
	 * which file to read and two notes that happen to match cost one copy.
	 */
	private baseDir(): string {
		const dir = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/skybox`;
		return normalizePath(`${dir}/hub-base`);
	}

	private async baseText(hash: string): Promise<string | null> {
		try {
			const path = `${this.baseDir()}/${hash}`;
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return await this.app.vault.adapter.read(path);
		} catch (error) {
			console.error("Skybox: could not read what both sides started from", error);
			return null;
		}
	}

	/**
	 * Keeping a copy of every agreed note, and throwing away the copies
	 * nothing agrees on any more. Only text, and only what the merge could
	 * use: a baseline for an image would be bytes nobody will ever diff.
	 */
	private async keepBases(agreed: Map<string, string>): Promise<void> {
		try {
			const dir = this.baseDir();
			if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);

			const wanted = new Set<string>();
			for (const [path, hash] of agreed) {
				const said = this.text.get(path);
				if (said === undefined) continue;
				wanted.add(hash);
				const at = `${dir}/${hash}`;
				if (await this.app.vault.adapter.exists(at)) continue;
				await this.app.vault.adapter.write(at, said);
			}
			// Every other baseline this device still holds is wanted too, even
			// where the text was not read this time round.
			for (const hashes of Object.values(this.agreed)) {
				for (const hash of Object.values(hashes)) wanted.add(hash);
			}
			const held = await this.app.vault.adapter.list(dir);
			for (const path of held.files) {
				const hash = path.slice(path.lastIndexOf("/") + 1);
				if (!wanted.has(hash)) await this.app.vault.adapter.remove(path);
			}
		} catch (error) {
			console.error("Skybox: could not keep the content baselines", error);
		}
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

/**
 * The text of a file, where merging it makes sense at all: Markdown, and
 * decodable as UTF-8. Anything else is bytes, and bytes have no lines.
 */
function mergeable(path: string, bytes: ArrayBuffer): string | null {
	if (!path.toLowerCase().endsWith(".md")) return null;
	// A megabyte of one note is far past anything worth merging quietly.
	if (bytes.byteLength > 1024 * 1024) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function bytes2(text: string): ArrayBuffer {
	const encoded = new TextEncoder().encode(text);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

async function hashOf(text: string): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", bytes2(text)));
}
