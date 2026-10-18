import { useCallback, useEffect, useState } from "react";
import { Notice, type TFile } from "obsidian";
import { useSkybox } from "../context";
import type { MastodonReply, MastodonStatus, Visibility } from "../mastodon";
import { clientFor } from "../sharing";

/**
 * The thread under a shared card, beside the note rather than in a browser.
 *
 * What is shown is read from the instance each time the tab is opened, and
 * nothing is written into the vault: a conversation belongs to the server it
 * happened on, and a copy in the note would be stale the moment someone else
 * replied. Replying posts as the connected account, in the same thread.
 */
export function Conversation({ note, statusId }: { note: TFile; statusId: string }) {
	const { app, settings } = useSkybox();
	const [status, setStatus] = useState<MastodonStatus | null>(null);
	const [replies, setReplies] = useState<MastodonReply[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
	const [trouble, setTrouble] = useState("");
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);

	const read = useCallback(async () => {
		const client = clientFor(app, settings);
		if (!client) {
			setState("failed");
			setTrouble("No account is connected. Settings, Share to Mastodon.");
			return;
		}
		setState("loading");
		try {
			const [found, thread] = await Promise.all([
				client.status(statusId),
				client.replies(statusId),
			]);
			setStatus(found);
			setReplies(thread);
			setState("ready");
		} catch (error) {
			setState("failed");
			setTrouble(error instanceof Error ? error.message : String(error));
		}
	}, [app, settings, statusId]);

	useEffect(() => {
		void read();
	}, [read]);

	const send = async () => {
		const text = draft.trim();
		if (!text || sending) return;
		const client = clientFor(app, settings);
		if (!client) return;
		setSending(true);
		try {
			await client.post(text, settings.mastodonVisibility as Visibility, [], statusId);
			setDraft("");
			await read();
		} catch (error) {
			new Notice(
				`Skybox could not post that reply: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="skybox-thread">
			{state === "loading" && <p className="skybox-meta-none">reading the thread…</p>}
			{state === "failed" && <p className="skybox-meta-none">{trouble}</p>}

			{state === "ready" && (
				<>
					<div className="skybox-thread-counts">
						<span>
							{replies.length} {replies.length === 1 ? "reply" : "replies"}
						</span>
						<span>{status?.favouritesCount ?? 0} favourites</span>
						<span>{status?.reblogsCount ?? 0} boosts</span>
						<button
							className="skybox-thread-refresh"
							onClick={() => void read()}
							aria-label="Read the thread again"
						>
							refresh
						</button>
					</div>

					{status?.url && (
						<a className="skybox-thread-link" href={status.url}>
							{note.basename} on Mastodon
						</a>
					)}

					{replies.length === 0 && <p className="skybox-meta-none">nobody has replied yet</p>}

					<ol className="skybox-thread-list">
						{replies.map((reply) => (
							<li key={reply.id}>
								<div className="skybox-thread-who">
									{reply.avatar && <img src={reply.avatar} alt="" loading="lazy" />}
									<a href={reply.url}>@{reply.handle}</a>
									<time dateTime={reply.at}>{when(reply.at)}</time>
								</div>
								<p>{reply.text}</p>
							</li>
						))}
					</ol>

					<div className="skybox-thread-reply">
						<textarea
							placeholder="reply as yourself"
							value={draft}
							disabled={sending}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								// Enter is a new line in a reply; sending is deliberate.
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									void send();
								}
							}}
						/>
						<button disabled={sending || draft.trim() === ""} onClick={() => void send()}>
							{sending ? "posting…" : "reply"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

/** Rough and readable: a thread is read in minutes and days, not timestamps. */
function when(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d`;
	return new Date(at).toISOString().slice(0, 10);
}
