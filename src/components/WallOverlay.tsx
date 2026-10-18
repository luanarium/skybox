import { useEffect, useState } from "react";
import { Notice, TFile } from "obsidian";
import { useSkybox } from "../context";
import { ensureFolder, noteTitle, uniquePath } from "../ingest";
import type { WallPost } from "../mastodon";
import type { Item } from "../types";
import { postFromNote, quoteIds, WALL_TAG } from "../wall";
import { guarded } from "../writes";
import { Post } from "./Post";

/**
 * A post, on the wall or kept.
 *
 * A card from the wall carries its post; a kept one carries a note, and the
 * post is read back out of it, so what you see is the same either way. The
 * note is never shown as markdown to edit: it is a copy of something somebody
 * else wrote, and the part of it that goes on changing is the thread, which
 * is read live.
 */
export function WallOverlay({
	item,
	onClose,
}: {
	item: Item;
	onClose: (keepFocus?: boolean) => void;
}) {
	const { app, index, settings } = useSkybox();
	const [post, setPost] = useState<WallPost | null>(item.remote ?? null);
	const [kept, setKept] = useState(!item.remote);
	const [keeping, setKeeping] = useState(false);

	// A kept post lives in a note; read it back rather than asking the server.
	useEffect(() => {
		if (item.remote) return;
		let live = true;
		void app.vault.cachedRead(item.file).then((body) => {
			if (!live) return;
			const front = app.metadataCache.getFileCache(item.file)?.frontmatter ?? {};
			setPost(postFromNote(front as Record<string, unknown>, body));
			// Posts kept before the ids were quoted are put right in passing.
			if (quoteIds(body)) {
				void guarded(() =>
					app.vault.process(item.file, (current) => quoteIds(current) ?? current)
				);
			}
		});
		return () => {
			live = false;
		};
	}, [app, item.file, item.mtime, item.remote]);

	const keep = async () => {
		if (keeping || kept || !post) return;
		setKeeping(true);
		try {
			const folder = await ensureFolder(app, settings.intakeFolder);
			const path = await uniquePath(
				app,
				folder,
				`${noteTitle(post.text || `${post.author} on the wall`)}.md`
			);
			const file = await guarded(() => app.vault.create(path, keptNote(post)));
			index.ensure(file);
			setKept(true);
			new Notice("Kept, and the conversation comes with it.");
		} catch (error) {
			new Notice(
				`Skybox could not keep that: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			setKeeping(false);
		}
	};

	return (
		<div
			className="skybox-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="skybox-expanded skybox-wall">
				<header className="skybox-expanded-head">
					<h2>{post?.author || item.title}</h2>
					<div className="skybox-expanded-actions">
						<button className="skybox-close" aria-label="Close" onClick={() => onClose()}>
							×
						</button>
					</div>
				</header>

				{post ? (
					<Post
						post={post}
						kept={kept || keeping}
						onKeep={item.remote ? () => void keep() : undefined}
					/>
				) : (
					<div className="skybox-expanded-body">
						<p className="skybox-meta-none">this post could not be read back</p>
					</div>
				)}
			</div>
		</div>
	);
}

/** What keeping a post writes: the properties a clipped page carries, plus
 * the ids the thread and the follow button need. */
export function keptNote(post: WallPost): string {
	const lines = [
		"---",
		`title: ${quote(post.author || `@${post.handle}`)}`,
		`source: ${post.url}`,
		`author: ${quote(`@${post.handle}`)}`,
		`created: ${new Date(post.at || Date.now()).toISOString().slice(0, 10)}`,
		// Quoted, because a status id is longer than YAML's numbers go.
		`mastodon_id: "${post.id}"`,
		`mastodon_url: ${post.url}`,
	];
	if (post.accountId) lines.push(`mastodon_account: "${post.accountId}"`);
	if (post.media[0]) lines.push(`image: ${post.media[0]}`);
	lines.push("tags:", `  - ${WALL_TAG}`);
	for (const tag of post.tags) lines.push(`  - ${tag}`);
	lines.push("---", "", post.text.trim(), "", `<${post.url}>`, "");
	return lines.join("\n");
}

function quote(value: string): string {
	return /^[\w][\w ,.'()/@-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

export type { TFile };
