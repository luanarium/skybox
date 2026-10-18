import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice, Platform, TFile } from "obsidian";
import { useSkybox } from "../context";
import { Conversation } from "./Conversation";
import { Icon } from "./Icon";
import { useBack } from "./useBack";
import { unreadTotal } from "../mastodon";
import { coverClass } from "../cover";
import { coverLink, sameCover } from "../preview";
import { isImageExtension } from "../types";
import { guarded } from "../writes";

interface MetadataBoxProps {
	/** The note carrying the metadata: a note itself, or an image's sidecar. */
	note: TFile | null;
	/** The file whose dates are shown. */
	file: TFile;
	tags: string[];
	onOpenPath: (path: string) => void;
	/** Creates the sidecar for an image that has none yet. */
	ensureNote?: () => Promise<TFile>;
}

export function MetadataBox({ note, file, tags, onOpenPath, ensureNote }: MetadataBoxProps) {
	const { app, index, interactions } = useSkybox();
	const [draft, setDraft] = useState("");
	/**
	 * Shown straight away, then reconciled with the index: a tag written to
	 * frontmatter only comes back through the metadata cache, and a note open
	 * in an editor can take a couple of seconds to get there.
	 */
	const [shown, setShown] = useState<string[]>(tags);
	const signature = tags.join("\u0000");
	useEffect(() => setShown(tags), [signature]);

	const frontmatter = note ? app.metadataCache.getFileCache(note)?.frontmatter ?? {} : {};
	const properties = Object.entries(frontmatter).filter(
		([key]) => key !== "tags" && key !== "tag" && key !== "hash"
	);

	/**
	 * The images this note embeds, which are what its card can show. The first
	 * is the cover unless one has been picked, so a note with only one image
	 * has nothing to choose and the row stays away.
	 */
	const embedded = useMemo(() => {
		if (!note || note.extension !== "md") return [];
		const cache = app.metadataCache.getFileCache(note);
		const found: TFile[] = [];
		for (const embed of cache?.embeds ?? []) {
			const target = app.metadataCache.getFirstLinkpathDest(embed.link, note.path);
			if (
				target instanceof TFile &&
				isImageExtension(target.extension) &&
				!found.some((seen) => seen.path === target.path)
			) {
				found.push(target);
			}
		}
		return found;
	}, [app, note?.path, note?.stat.mtime]);

	const chosen = embedded.find((image) => sameCover(frontmatter.cover, image.path));
	const cover = chosen ?? embedded[0];

	/** Picking the one already showing puts the drawn cover back. */
	const pickCover = async (image: TFile | null) => {
		if (!note) return;
		await guarded(() =>
			app.fileManager.processFrontMatter(note, (front) => {
				if (!image || (embedded[0] && image.path === embedded[0].path && !front.cover)) {
					delete front.cover;
					return;
				}
				front.cover = coverLink(image.path);
			})
		);
		index.ensure(note);
	};

	/** Only frontmatter tags can be taken off here; the body's are the body's. */
	const written = new Set(frontmatterTags(frontmatter));

	const suggestions = useMemo(
		() => (Platform.isMobile ? [] : index.tags().filter((tag) => !shown.includes(tag))),
		[index, shown, signature]
	);

	const links = useMemo(() => {
		if (!note) return [];
		const cache = app.metadataCache.getFileCache(note);
		const seen = new Set<string>();
		const out: { path: string; label: string }[] = [];
		for (const link of cache?.links ?? []) {
			const target = app.metadataCache.getFirstLinkpathDest(link.link, note.path);
			const path = target?.path ?? link.link;
			if (seen.has(path)) continue;
			seen.add(path);
			out.push({ path, label: link.displayText ?? link.link });
		}
		return out;
	}, [app, note, note?.stat.mtime]);

	const backlinks = useMemo(() => {
		if (!note) return [];
		const out: string[] = [];
		const resolved = app.metadataCache.resolvedLinks;
		for (const [source, targets] of Object.entries(resolved)) {
			if (source === note.path) continue;
			if (targets[note.path]) out.push(source);
		}
		return out;
	}, [app, note, note?.stat.mtime]);

	const addTag = async (raw: string) => {
		const tag = raw.replace(/^#/, "").trim();
		setDraft("");
		if (!tag || shown.includes(tag)) return;
		setShown((current) => [...current, tag]);
		try {
			// An image has no note of its own until its first tag asks for one.
			const target = note ?? (ensureNote ? await ensureNote() : null);
			if (!target) throw new Error("nothing to write the tag to");
			await guarded(() =>
				app.fileManager.processFrontMatter(target, (matter) => {
					const current = frontmatterTags(matter);
					if (!current.includes(tag)) matter[tagKey(matter)] = [...current, tag];
				})
			);
		} catch (error) {
			console.error("Skybox: the tag could not be written", error);
			new Notice(`“${tag}” could not be saved`);
			setShown((current) => current.filter((existing) => existing !== tag));
		}
	};

	const removeTag = async (tag: string) => {
		if (!note) return;
		setShown((current) => current.filter((existing) => existing !== tag));
		try {
			await guarded(() =>
				app.fileManager.processFrontMatter(note, (matter) => {
					const key = tagKey(matter);
					const remaining = frontmatterTags(matter).filter((existing) => existing !== tag);
					if (remaining.length === 0) delete matter[key];
					else matter[key] = remaining;
				})
			);
		} catch (error) {
			console.error("Skybox: the tag could not be taken off", error);
			new Notice(`“${tag}” could not be removed`);
			setShown((current) => [...current, tag]);
		}
	};

	/*
	 * A shared card has a conversation somewhere else, which is too much to
	 * put under the properties in a column this narrow. Two tabs: what the
	 * note is, and what was said about it.
	 */
	const statusId = frontmatter.mastodon_id ? String(frontmatter.mastodon_id) : "";
	const [tab, setTab] = useState<"note" | "thread">(statusId ? "thread" : "note");
	/*
	 * A phone stacks the pane under the editor, which puts a thread a long
	 * way down a scroll. There it opens as a sheet of its own instead, from a
	 * button that says how much is waiting.
	 */
	const [sheeted, setSheeted] = useState(false);
	const [typingHere, setTypingHere] = useState(false);
	/*
	 * Back closes the thread rather than the card it is drawn over, which
	 * takes a modal standing in Obsidian's stack of closeable things. A modal
	 * keeps focus to itself, though, so while the reply box has the cursor
	 * the stand-in steps aside: Android's own first back closes the keyboard,
	 * and the one after that closes the thread.
	 */
	const closeSheet = useCallback(() => setSheeted(false), []);
	useBack(app, sheeted && !typingHere, closeSheet);
	const waiting = statusId ? unreadTotal(interactions.unreadFor(statusId)) : 0;
	/*
	 * A shared card opens on its conversation, because that is the part that
	 * is somewhere else and may have moved since you last looked. An empty
	 * thread is still the right place to be: the reply box is there, and a
	 * card you have just shared is one you have something to say about.
	 */
	useEffect(() => {
		setTab(statusId ? "thread" : "note");
	}, [statusId]);

	return (
		<aside className="skybox-meta">
			{statusId && note && Platform.isMobile && (
				<section className="skybox-meta-section">
					<button className="skybox-thread-open" onClick={() => setSheeted(true)}>
						{waiting > 0 ? `${waiting} ${waiting === 1 ? "comment" : "comments"}` : "Comments"}
					</button>
				</section>
			)}

			{statusId && note && sheeted && (
				/*
				 * A panel over the card rather than a second modal. The card
				 * is already one on a phone, and opening another on top of it
				 * puts a keyboard into a stack of modals, which ends with an
				 * empty sheet and nothing to type into.
				 */
				<div
					className="skybox-thread-panel"
					onFocusCapture={() => setTypingHere(true)}
					onBlurCapture={() => setTypingHere(false)}
				>
					<div className="skybox-thread-panel-head">
						<button
							className="skybox-back-arrow"
							aria-label="Back to the card"
							onClick={closeSheet}
						>
							<Icon name="arrow-left" />
						</button>
						<h2>{waiting > 0 ? `${waiting} ${waiting === 1 ? "comment" : "comments"}` : "Comments"}</h2>
					</div>
					<Conversation note={note} statusId={statusId} />
				</div>
			)}

			{statusId && note && !Platform.isMobile && (
				<div className="skybox-meta-tabs">
					<button
						className={tab === "note" ? "is-on" : ""}
						onClick={() => setTab("note")}
					>
						Properties
					</button>
					<button
						className={tab === "thread" ? "is-on" : ""}
						onClick={() => setTab("thread")}
					>
						Conversation
					</button>
				</div>
			)}

			{statusId && note && !Platform.isMobile && tab === "thread" && (
				<Conversation note={note} statusId={statusId} />
			)}

			{(Platform.isMobile || tab === "note") && (
				<>
			<section className="skybox-meta-section">
				<h4>Tags</h4>
				<div className="skybox-meta-tags">
					{shown.length === 0 && <span className="skybox-meta-none">no tags yet</span>}
					{shown.map((tag) => (
						<span className="skybox-tag is-editable" key={tag}>
							#{tag}
							{written.has(tag) && (
								<button
									className="skybox-chip-remove"
									aria-label={`Remove #${tag}`}
									onClick={() => void removeTag(tag)}
								>
									×
								</button>
							)}
						</span>
					))}
				</div>
				<input
					className="skybox-meta-input"
					placeholder="add a tag"
					value={draft}
					// Android turns a datalist into a full-height picker, over the
					// box being typed into.
					list={Platform.isMobile ? undefined : TAG_SUGGESTIONS}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void addTag(draft);
						}
					}}
				/>
				{!Platform.isMobile && (
					<datalist id={TAG_SUGGESTIONS}>
						{suggestions.map((tag) => (
							<option value={tag} key={tag} />
						))}
					</datalist>
				)}
			</section>

			{embedded.length > 1 && (
				<section className="skybox-meta-section">
					<h4>Cover</h4>
					<div className="skybox-meta-covers">
						{embedded.map((image) => (
							<button
								key={image.path}
								className={`skybox-meta-cover${
									cover?.path === image.path ? " is-chosen" : ""
								}`}
								aria-label={`Use ${image.name} as the cover`}
								onClick={() => void pickCover(image)}
							>
								<img src={app.vault.getResourcePath(image)} alt="" loading="lazy" />
							</button>
						))}
						<button
							className={`skybox-meta-cover is-drawn${cover ? "" : " is-chosen"}`}
							aria-label="Use the drawn cover"
							onClick={() => void pickCover(null)}
						>
							<span className={coverClass(file.path)} />
						</button>
					</div>
				</section>
			)}

			{properties.length > 0 && (
				<section className="skybox-meta-section">
					<h4>Properties</h4>
					<dl className="skybox-meta-properties">
						{properties.map(([key, value]) => (
							<div key={key}>
								<dt>{key}</dt>
								<dd>{formatValue(value)}</dd>
							</div>
						))}
					</dl>
				</section>
			)}

			{links.length > 0 && (
				<section className="skybox-meta-section">
					<h4>Links</h4>
					<ul className="skybox-meta-list">
						{links.map((link) => (
							<li key={link.path}>
								<a onClick={() => onOpenPath(link.path)}>{link.label}</a>
							</li>
						))}
					</ul>
				</section>
			)}

			{backlinks.length > 0 && (
				<section className="skybox-meta-section">
					<h4>Backlinks</h4>
					<ul className="skybox-meta-list">
						{backlinks.map((path) => (
							<li key={path}>
								<a onClick={() => onOpenPath(path)}>{basename(path)}</a>
							</li>
						))}
					</ul>
				</section>
			)}

			<section className="skybox-meta-section">
				<h4>Dates</h4>
				<dl className="skybox-meta-properties">
					<div>
						<dt>created</dt>
						<dd>{formatDate(file.stat.ctime)}</dd>
					</div>
					<div>
						<dt>modified</dt>
						<dd>{formatDate(file.stat.mtime)}</dd>
					</div>
				</dl>
			</section>
				</>
			)}
		</aside>
	);
}

const TAG_SUGGESTIONS = "skybox-tag-suggestions";

/** Frontmatter holds tags as a list, a single string, or not at all. */
function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
	const tags = frontmatter?.tags ?? frontmatter?.tag;
	if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
	if (typeof tags === "string") {
		return tags
			.split(/[,\s]+/)
			.map((tag) => tag.replace(/^#/, "").trim())
			.filter(Boolean);
	}
	return [];
}

/** Writes go back to whichever key the note already uses. */
function tagKey(frontmatter: Record<string, unknown>): "tags" | "tag" {
	return !("tags" in frontmatter) && "tag" in frontmatter ? "tag" : "tags";
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) return value.join(", ");
	if (value === null || value === undefined) return "";
	return String(value);
}

function formatDate(stamp: number): string {
	return new Date(stamp).toLocaleString();
}

function basename(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}
