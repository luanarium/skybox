import { useCallback, useEffect, useState } from "react";
import { Platform } from "obsidian";
import { useSkybox } from "../context";
import { unreadTotal } from "../mastodon";
import { clientFor } from "../sharing";
import { Conversation } from "./Conversation";
import { Icon } from "./Icon";
import { useBack } from "./useBack";

/**
 * A thread on a phone, behind a button.
 *
 * A phone stacks a card's side pane under the card, which puts a conversation
 * a long way down a scroll and gives the post itself whatever is left. So the
 * thread is a button saying how much is waiting, and a panel over the card
 * when it is pressed. Wherever a conversation is drawn on a phone, it is drawn
 * through here: a kept post read as a post and a shared note read as a note
 * are the same thread underneath, and they had drifted into two.
 */
export function Comments({ title, statusId }: { title: string; statusId: string }) {
	const { app, settings, interactions } = useSkybox();
	const [open, setOpen] = useState(false);
	const [typingHere, setTypingHere] = useState(false);
	/*
	 * How many comments there are, which is what the button should say: the
	 * thread is read once when the card opens and again when the panel
	 * closes, since replying is the usual reason for the number to change.
	 * Nested replies count too, so this is the thread rather than Mastodon's
	 * own `replies_count`, which only counts what answers the post directly.
	 */
	const [comments, setComments] = useState<number | null>(null);

	/*
	 * Back closes the thread rather than the card it is drawn over, which
	 * takes a modal standing in Obsidian's stack of closeable things. A modal
	 * keeps focus to itself, though, so while the reply box has the cursor
	 * the stand-in steps aside: Android's own first back closes the keyboard,
	 * and the one after that closes the thread.
	 */
	const close = useCallback(() => setOpen(false), []);
	useBack(app, open && !typingHere, close);

	useEffect(() => {
		if (!statusId || open) return;
		const client = clientFor(app, settings);
		if (!client) return;
		let live = true;
		void client
			.replies(statusId)
			.then((thread) => {
				if (live) setComments(thread.length);
			})
			.catch(() => {
				// A count nobody could fetch is a button that says Comments.
				if (live) setComments(null);
			});
		return () => {
			live = false;
		};
	}, [app, settings, statusId, open]);

	const waiting = unreadTotal(interactions.unreadFor(statusId));
	const counted = comments === null ? "Comments" : `${comments} ${comments === 1 ? "comment" : "comments"}`;

	return (
		<>
			<section className="skybox-meta-section">
				<button className="skybox-thread-open" onClick={() => setOpen(true)}>
					{waiting > 0
						? `${waiting} unread ${waiting === 1 ? "comment" : "comments"}`
						: counted}
				</button>
			</section>

			{open && (
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
							onClick={close}
						>
							<Icon name="arrow-left" />
						</button>
						<h2>{counted}</h2>
					</div>
					<Conversation title={title} statusId={statusId} />
				</div>
			)}
		</>
	);
}

/** The thread as a phone shows it, or as a computer does. */
export function Thread({ title, statusId }: { title: string; statusId: string }) {
	return Platform.isMobile ? (
		<Comments title={title} statusId={statusId} />
	) : (
		<Conversation title={title} statusId={statusId} />
	);
}
