import { useEffect, useState } from "react";
import { Notice } from "obsidian";
import { useSkybox } from "../context";
import type { WallPost } from "../mastodon";
import { clientFor } from "../sharing";
import { Thread } from "./Comments";

/**
 * A post, drawn the same way wherever it is met.
 *
 * On the wall it is somebody else's and the question is whether to keep it.
 * Once kept it is a note in the vault, and the question is what has been said
 * under it since. Either way it is a post: the same picture, the same words,
 * the same boost and follow beside the same name, and the same thread. A kept
 * post is never shown as markdown to edit, because it is not yours to edit.
 */
export function Post({
	post,
	onKeep,
	kept,
}: {
	post: WallPost;
	/** Offered on the wall, absent once it has been kept. */
	onKeep?: () => void;
	kept?: boolean;
}) {
	const { app, settings } = useSkybox();
	const [boosted, setBoosted] = useState(post.boosted);
	const [boosts, setBoosts] = useState(post.reblogsCount);
	const [following, setFollowing] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);

	// Whether you follow them is a question only the instance can answer.
	useEffect(() => {
		if (!post.accountId) return;
		let live = true;
		const client = clientFor(app, settings);
		if (!client) return;
		void client
			.following([post.accountId])
			.then((who) => {
				if (live) setFollowing(who.has(post.accountId));
			})
			.catch(() => {
				// An older token has no read:follows. Offering to follow is
				// better than a button that can never answer: following is
				// idempotent, and a missing scope says so when pressed.
				if (live) setFollowing(false);
			});
		return () => {
			live = false;
		};
	}, [app, settings, post.accountId]);

	const act = async (what: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		try {
			await what();
		} catch (error) {
			new Notice(
				`Skybox could not do that: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			setBusy(false);
		}
	};

	const boost = () =>
		act(async () => {
			const client = clientFor(app, settings);
			if (!client) return;
			const after = await client.boost(post.id, !boosted);
			setBoosted(!boosted);
			setBoosts(after.reblogsCount || (boosted ? boosts - 1 : boosts + 1));
		});

	const follow = () =>
		act(async () => {
			const client = clientFor(app, settings);
			if (!client || !post.accountId) return;
			const now = await client.follow(post.accountId, following !== true);
			setFollowing(now);
			new Notice(now ? `Following @${post.handle}.` : `No longer following @${post.handle}.`);
		});

	return (
		<div className="skybox-expanded-body skybox-wall-body">
			<article className="skybox-wall-post">
				{post.boostedBy && (
					<p className="skybox-wall-passed">boosted by @{post.boostedBy}</p>
				)}
				<div className="skybox-wall-who">
					{post.avatar && <img src={post.avatar} alt="" loading="lazy" />}
					<a href={post.url}>@{post.handle}</a>
					{post.accountId && (
						<button
							className={`skybox-wall-follow${following ? " is-on" : ""}`}
							disabled={busy}
							onClick={() => void follow()}
						>
							{following === null ? "…" : following ? "following" : "follow"}
						</button>
					)}
					<time dateTime={new Date(post.at).toISOString()}>
						{post.at ? new Date(post.at).toLocaleString() : ""}
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
					<button
						className={`skybox-wall-boost${boosted ? " is-on" : ""}`}
						disabled={busy}
						onClick={() => void boost()}
					>
						{boosted ? "boosted" : "boost"} {boosts > 0 ? boosts : ""}
					</button>
					<span>{post.favouritesCount} favourites</span>
					{onKeep && (
						<button className="skybox-wall-keep" disabled={kept} onClick={onKeep}>
							{kept ? "kept" : "keep this"}
						</button>
					)}
				</div>
			</article>

			<aside className="skybox-meta">
				<Thread title={post.author || `@${post.handle}`} statusId={post.id} />
			</aside>
		</div>
	);
}
