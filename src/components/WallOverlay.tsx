import { useState } from "react";
import { Notice } from "obsidian";
import { useSkybox } from "../context";
import { ensureFolder, noteTitle, uniquePath } from "../ingest";
import type { WallPost } from "../mastodon";
import type { Item } from "../types";
import { guarded } from "../writes";
import { Conversation } from "./Conversation";

/**
 * A post from the wall, read where it is.
 *
 * Nothing of a hashtag timeline is written anywhere until it is asked for, so
 * this draws from what the instance said and keeps nothing. The thread under
 * it is the same conversation a shared card has, because it is the same
 * thing: statuses answering a status.
 *
 * Keeping one writes an ordinary note carrying the post's id, which is what
 * makes it an ordinary card afterwards: it is searched, it is tagged, its
 * conversation keeps working, and the unread count follows it.
 */
export function WallOverlay({ item, onClose }: { item: Item; onClose: (keepFocus?: boolean) => void }) {
	const { app, index, settings } = useSkybox();
	const post = item.remote as WallPost;
	const [kept, setKept] = useState<string | null>(null);
	const [keeping, setKeeping] = useState(false);

	const keep = async () => {
		if (keeping || kept) return;
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
			setKept(file.path);
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
					<h2>{post.author || `@${post.handle}`}</h2>
					<div className="skybox-expanded-actions">
						<button disabled={keeping || kept !== null} onClick={() => void keep()}>
							{kept ? "kept" : keeping ? "keeping…" : "keep this"}
						</button>
						<button className="skybox-close" aria-label="Close" onClick={() => onClose()}>
							×
						</button>
					</div>
				</header>

				<div className="skybox-expanded-body skybox-wall-body">
					<article className="skybox-wall-post">
						<div className="skybox-wall-who">
							{post.avatar && <img src={post.avatar} alt="" loading="lazy" />}
							<a href={post.url}>@{post.handle}</a>
							<time dateTime={new Date(post.at).toISOString()}>
								{new Date(post.at).toLocaleString()}
							</time>
						</div>
						<p>{post.text}</p>
						{post.media.length > 0 && (
							<div className="skybox-wall-media">
								{post.media.map((address) => (
									<img key={address} src={address} alt="" loading="lazy" />
								))}
							</div>
						)}
						<div className="skybox-wall-counts">
							<span>{post.repliesCount} replies</span>
							<span>{post.favouritesCount} favourites</span>
							<span>{post.reblogsCount} boosts</span>
						</div>
					</article>

					<aside className="skybox-meta">
						<Conversation title={post.author || `@${post.handle}`} statusId={post.id} />
					</aside>
				</div>
			</div>
		</div>
	);
}

/** What keeping a post writes: the same properties a clipped page carries. */
export function keptNote(post: WallPost): string {
	const lines = [
		"---",
		`title: ${quote(post.author || `@${post.handle}`)}`,
		`source: ${post.url}`,
		`author: ${quote(`@${post.handle}`)}`,
		`created: ${new Date(post.at || Date.now()).toISOString().slice(0, 10)}`,
		`mastodon_id: ${post.id}`,
		`mastodon_url: ${post.url}`,
	];
	if (post.media[0]) lines.push(`image: ${post.media[0]}`);
	lines.push("tags:", "  - wall");
	for (const tag of post.tags) lines.push(`  - ${tag}`);
	lines.push("---", "", post.text.trim(), "", `<${post.url}>`, "");
	return lines.join("\n");
}

function quote(value: string): string {
	return /^[\w][\w ,.'()/@-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}
