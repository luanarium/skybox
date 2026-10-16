import { useEffect, useMemo, useState } from "react";
import { Notice, Platform, TFile } from "obsidian";
import { useTelegrid } from "../context";
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
	const { app, index } = useTelegrid();
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
			console.error("Telegrid: the tag could not be written", error);
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
			console.error("Telegrid: the tag could not be taken off", error);
			new Notice(`“${tag}” could not be removed`);
			setShown((current) => [...current, tag]);
		}
	};

	return (
		<aside className="telegrid-meta">
			<section className="telegrid-meta-section">
				<h4>Tags</h4>
				<div className="telegrid-meta-tags">
					{shown.length === 0 && <span className="telegrid-meta-none">no tags yet</span>}
					{shown.map((tag) => (
						<span className="telegrid-tag is-editable" key={tag}>
							#{tag}
							{written.has(tag) && (
								<button
									className="telegrid-chip-remove"
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
					className="telegrid-meta-input"
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

			{properties.length > 0 && (
				<section className="telegrid-meta-section">
					<h4>Properties</h4>
					<dl className="telegrid-meta-properties">
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
				<section className="telegrid-meta-section">
					<h4>Links</h4>
					<ul className="telegrid-meta-list">
						{links.map((link) => (
							<li key={link.path}>
								<a onClick={() => onOpenPath(link.path)}>{link.label}</a>
							</li>
						))}
					</ul>
				</section>
			)}

			{backlinks.length > 0 && (
				<section className="telegrid-meta-section">
					<h4>Backlinks</h4>
					<ul className="telegrid-meta-list">
						{backlinks.map((path) => (
							<li key={path}>
								<a onClick={() => onOpenPath(path)}>{basename(path)}</a>
							</li>
						))}
					</ul>
				</section>
			)}

			<section className="telegrid-meta-section">
				<h4>Dates</h4>
				<dl className="telegrid-meta-properties">
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
		</aside>
	);
}

const TAG_SUGGESTIONS = "telegrid-tag-suggestions";

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
