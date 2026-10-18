import { useEffect, useMemo, useRef, useState } from "react";
import { Notice, Platform, TFile } from "obsidian";
import { useSkybox } from "../context";
import { DirectMessages } from "../dm";
import { MailImport } from "../mail";
import { parseThreadNote, type Thread, type ThreadMessage } from "../thread";
import type { Item } from "../types";
import { guarded } from "../writes";
import { Icon } from "./Icon";

/**
 * A conversation, in a window that remembers what mail used to look like.
 *
 * Mail and direct messages arrive as the same note, so this reads the note
 * rather than either backend: who said what, in order, each with its time.
 * Replying hands the words to whichever backend the note says carried it,
 * and nothing here knows more about the difference than that.
 *
 * The composer is a `contenteditable`, because the point of an email
 * composer is that bold and italic are where you are typing rather than in
 * the text as markup.
 */

interface MailOverlayProps {
	item: Item;
	onClose: (keepFocus?: boolean) => void;
	onOpenPath: (path: string) => void;
}

export function MailOverlay({ item, onClose }: MailOverlayProps) {
	const { app, settings, index } = useSkybox();
	const [messages, setMessages] = useState<ThreadMessage[]>([]);
	const [sending, setSending] = useState(false);
	const [bold, setBold] = useState(false);
	const [italic, setItalic] = useState(false);
	const box = useRef<HTMLDivElement>(null);

	const front = app.metadataCache.getFileCache(item.file)?.frontmatter ?? {};
	// The id a reply answers, which the note carries because the messages in
	// its body do not.
	const lastId = String(front.thread_last ?? "");
	const thread = useMemo<Thread>(
		() => ({
			id: String(front.thread_id ?? ""),
			source: front.thread_source === "mastodon" ? "mastodon" : "mail",
			subject: String(front.subject ?? item.title),
			with: String(front.thread_with ?? ""),
			messages,
			unread: front.unread === true,
		}),
		[front.thread_id, front.thread_source, front.subject, front.thread_with, front.unread, item.title, messages]
	);

	useEffect(() => {
		let live = true;
		void app.vault.cachedRead(item.file).then((note) => {
			if (live) setMessages(parseThreadNote(note, settings.mailAddress));
		});
		return () => {
			live = false;
		};
	}, [app, item.file, item.mtime, settings.mailAddress]);

	// Opening a conversation is reading it, wherever you opened it.
	useEffect(() => {
		if (front.unread !== true) return;
		void guarded(() =>
			app.fileManager.processFrontMatter(item.file, (data) => {
				data.unread = false;
			})
		);
	}, [app, item.file, front.unread]);

	const style = (command: "bold" | "italic") => {
		box.current?.focus();
		// Deprecated and still the only thing that does this in one line.
		document.execCommand(command);
		setBold(document.queryCommandState("bold"));
		setItalic(document.queryCommandState("italic"));
	};

	const send = async () => {
		const node = box.current;
		if (!node || sending) return;
		const html = cleanHtml(node.innerHTML);
		const text = node.innerText.trim();
		if (!text) return;

		setSending(true);
		try {
			const sent =
				thread.source === "mastodon"
					? await new DirectMessages(app, settings).send(thread, text, lastId)
					: await new MailImport(app, settings).send(thread, text, html, lastId);
			if (!sent) return;
			node.innerHTML = "";
			// Said, and shown as said, until the backend brings it back.
			setMessages((current) => [
				...current,
				{
					id: "",
					who: settings.mailAddress || "you",
					at: Date.now(),
					text,
					mine: true,
				},
			]);
			new Notice(thread.source === "mastodon" ? "Sent." : "Left in the outbox.");
			index.ensure(item.file);
		} finally {
			setSending(false);
		}
	};

	return (
		<div
			className="skybox-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="skybox-expanded skybox-mail">
				<div className="mail-window">
					<div className="mail-title-bar">
						{Platform.isMobile && (
							<button
								className="skybox-back-arrow"
								aria-label="Back to the grid"
								onClick={() => onClose()}
							>
								<Icon name="arrow-left" />
							</button>
						)}
						<span className="mail-title-bar-text">{thread.subject}</span>
						{!Platform.isMobile && (
							<button
								className="mail-close"
								aria-label="Close"
								onClick={() => onClose()}
							>
								×
							</button>
						)}
					</div>

					<div className="mail-body">
						<div className="mail-with">
							{thread.source === "mastodon" ? "Direct message with" : "Conversation with"}{" "}
							<strong>{thread.with}</strong>
						</div>

						<ol className="mail-thread">
							{messages.map((message, position) => (
								<li
									key={`${message.at}-${position}`}
									className={message.mine ? "is-mine" : ""}
								>
									<div className="mail-message-head">
										<span className="mail-who">{message.who}</span>
										<time dateTime={new Date(message.at).toISOString()}>
											{when(message.at)}
										</time>
									</div>
									<p>{message.text}</p>
								</li>
							))}
							{messages.length === 0 && <li className="mail-empty">nothing in this thread yet</li>}
						</ol>

						<div className="mail-composer">
							<div className="mail-tools">
								<button
									className={bold ? "is-on" : ""}
									aria-label="Bold"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => style("bold")}
								>
									<b>B</b>
								</button>
								<button
									className={italic ? "is-on" : ""}
									aria-label="Italic"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => style("italic")}
								>
									<i>I</i>
								</button>
							</div>
							<div
								ref={box}
								className="mail-write"
								contentEditable
								role="textbox"
								aria-label="Write a reply"
								suppressContentEditableWarning
								onKeyUp={() => {
									setBold(document.queryCommandState("bold"));
									setItalic(document.queryCommandState("italic"));
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
										event.preventDefault();
										void send();
									}
								}}
							/>
							<div className="mail-send">
								<button disabled={sending} onClick={() => void send()}>
									{sending ? "Sending…" : "Send"}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/** What a reply may carry into mail: emphasis, breaks, and nothing else. */
export function cleanHtml(html: string): string {
	return html
		.replace(/<(?!\/?(b|strong|i|em|br|p|div|ul|ol|li|a)\b)[^>]*>/gi, "")
		.replace(/\s(on\w+|style|class|id)="[^"]*"/gi, "")
		.replace(/<div>/gi, "<p>")
		.replace(/<\/div>/gi, "</p>")
		.trim();
}

function when(at: number): string {
	if (!at) return "";
	const date = new Date(at);
	const today = new Date();
	const sameDay = date.toDateString() === today.toDateString();
	return sameDay
		? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
		: `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export type { TFile };
