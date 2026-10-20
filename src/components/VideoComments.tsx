import { useEffect, useState } from "react";
import { requestUrl } from "obsidian";
import { topComments, type VideoComment } from "../youtube";

/**
 * The top comments under a video, read only.
 *
 * They are drawn the way a Mastodon thread is drawn, because they are the
 * same thing to a reader: a name, a time, some words. What is missing is
 * deliberate. There is no reply box and no nesting, since there is no account
 * here to reply with and no route to post one; a comment with answers under
 * it says how many and leaves them on YouTube.
 */
export function VideoComments({ id }: { id: string }) {
	const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
	const [comments, setComments] = useState<VideoComment[]>([]);
	const [why, setWhy] = useState("");

	useEffect(() => {
		let live = true;
		setState("loading");
		void topComments((options) => requestUrl(options), id).then((found) => {
			if (!live) return;
			setComments(found.comments);
			setWhy(found.why);
			setState(found.comments.length > 0 ? "ready" : "empty");
		});
		return () => {
			live = false;
		};
	}, [id]);

	return (
		<div className="skybox-thread skybox-video-comments">
			<div className="skybox-thread-counts">
				<span>{state === "ready" ? `top ${comments.length} comments` : "comments"}</span>
				<span className="skybox-video-readonly">read only</span>
			</div>

			{state === "loading" && <p className="skybox-meta-none">reading the comments…</p>}
			{state === "empty" && <p className="skybox-meta-none">{why || "nothing to show"}</p>}

			{state === "ready" && (
				<ol className="skybox-thread-list">
					{comments.map((comment) => (
						<li key={comment.id}>
							<div className="skybox-thread-who">
								{comment.avatar && <img src={comment.avatar} alt="" loading="lazy" />}
								<span className="skybox-video-author">{comment.author}</span>
								<time>{comment.when}</time>
								{comment.pinned && <span className="skybox-video-pinned">pinned</span>}
							</div>
							<p>{comment.text}</p>
							<div className="skybox-video-counts">
								{comment.likes && <span>{comment.likes} likes</span>}
								{comment.replies > 0 && (
									<span>
										{comment.replies} {comment.replies === 1 ? "reply" : "replies"} on YouTube
									</span>
								)}
							</div>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
