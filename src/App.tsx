import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Menu, Platform } from "obsidian";
import { copyItem } from "./clipboard";
import { ask } from "./confirm";
import { useSkybox } from "./context";
import { createNote, ingest } from "./ingest";
import { openPluginSettings } from "./preferences";
import { type Chip, search } from "./search";
import { withTransition } from "./transition";
import { UNREAD_TAG, type Item } from "./types";
import { BottomBar } from "./components/BottomBar";
import { Card } from "./components/Card";
import { Composer } from "./components/Composer";
import { Icon } from "./components/Icon";
import { Lightbox } from "./components/Lightbox";
import { MailOverlay } from "./components/MailOverlay";
import { Masonry } from "./components/Masonry";
import { WallOverlay } from "./components/WallOverlay";
import { clientFor } from "./sharing";
import { isKeptPost, narrowWall, wallItem, wallSourceOf } from "./wall";
import { NoteOverlay } from "./components/NoteOverlay";
import { Sheet } from "./components/Sheet";
import { SearchBox } from "./components/SearchBox";

const PAGE = 100;

/** The oldest post on the wall, which is where the next page starts. */
function lastPostId(items: Item[]): string {
	const last = items[items.length - 1];
	// A boost pages by its own id, not by the id of the post inside it.
	return last?.remote?.entryId || last?.remote?.id || "";
}

export function App() {
	const { app, index, settings, bus, leaf, interactions, setStandalone } = useSkybox();
	const [chips, setChips] = useState<Chip[]>([]);
	const [draft, setDraft] = useState("");
	const [version, setVersion] = useState(0);
	const [results, setResults] = useState<Item[]>([]);
	const [limit, setLimit] = useState(PAGE);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [namedId, setNamedId] = useState<string | null>(null);
	const [dropping, setDropping] = useState(false);
	const [dropped, setDropped] = useState<Set<string>>(new Set());
	const [typing, setTyping] = useState(false);
	const [composing, setComposing] = useState(false);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const seen = useRef(new Set<string>());
	const sentinel = useRef<HTMLDivElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => index.subscribe(() => setVersion((n) => n + 1)), [index]);

	/*
	 * The plus button does double duty. While something is waiting on a
	 * shared card it changes colour, and a press puts the #comments chip in
	 * the search box rather than opening the menu, which is what the button
	 * is for in that moment. Pressing it settles the colour until something
	 * new arrives, and a right click or a long press opens the menu either
	 * way, so making a note never becomes unreachable.
	 */
	const [waiting, setWaiting] = useState(() => interactions.total());
	const [settled, setSettled] = useState(() => interactions.total());
	useEffect(() => interactions.subscribe(() => setWaiting(interactions.total())), [interactions]);
	const glowing = waiting > settled;

	const showWaiting = useCallback(() => {
		setSettled(waiting);
		setChips((current) =>
			current.some((chip) => chip.tagOnly && chip.text === UNREAD_TAG)
				? current
				: [...current, { text: UNREAD_TAG, tagOnly: true }]
		);
	}, [waiting]);

	/*
	 * A chip beginning `#!` asks the fediverse instead of the vault, and the
	 * grid fills with that hashtag's public timeline. Nothing of it is kept:
	 * clearing the chip clears the wall.
	 */
	const source = wallSourceOf(chips);
	const tag = source?.tag ?? null;
	/** How far down the wall has been read, for asking for the next page. */
	const [wall, setWall] = useState<Item[]>([]);
	const [wallEnd, setWallEnd] = useState(false);
	const reading = useRef(false);

	const readWall = useCallback(
		async (before: string) => {
			if (!source || reading.current) return;
			const client = clientFor(app, settings);
			if (!client) {
				setWall([]);
				return;
			}
			reading.current = true;
			try {
				const posts =
					source.kind === "home"
						? await client.home(40, before)
						: await client.hashtag(source.tag, 40, before);
				const fresh = narrowWall(posts, chips, source.tag).map(wallItem);
				// A page that brings nothing back is the end of the wall.
				setWallEnd(posts.length === 0);
				setWall((current) => {
					if (!before) return fresh;
					const seen = new Set(current.map((item) => item.id));
					return [...current, ...fresh.filter((item) => !seen.has(item.id))];
				});
			} catch (error) {
				console.error("Skybox: could not read that wall", error);
				if (!before) setWall([]);
			} finally {
				reading.current = false;
			}
		},
		[app, settings, source?.kind, source?.tag, chips]
	);

	useEffect(() => {
		if (!source) {
			setWall([]);
			setWallEnd(false);
			return;
		}
		setWallEnd(false);
		void readWall("");
	}, [source?.kind, source?.tag, readWall]);

	useEffect(() => {
		if (tag) {
			setResults(wall);
			setFresh(new Set());
		}
	}, [tag, wall]);

	useEffect(() => {
		if (tag) return;
		let current = true;
		void search(index, chips, settings.hideEmbedded).then((found) => {
			if (!current) return;
			setResults(found);
			const ids = new Set(found.map((item) => item.id));
			setFresh(new Set([...ids].filter((id) => !seen.current.has(id))));
			seen.current = ids;
		});
		return () => {
			current = false;
		};
	}, [index, chips, version, settings.hideEmbedded, tag]);

	useEffect(() => setLimit(PAGE), [chips]);

	/*
	 * A phone's keyboard shrinks the window rather than covering it, which
	 * carries anything pinned to the bottom up into the middle of the screen.
	 * While a field has the cursor, that furniture stands down.
	 */
	useEffect(() => {
		const isField = (node: unknown): boolean =>
			node instanceof HTMLElement &&
			(node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
		const onIn = (event: FocusEvent) => {
			if (isField(event.target)) setTyping(true);
		};
		const onOut = () => {
			// Focus may be on its way to another field.
			window.setTimeout(() => setTyping(isField(document.activeElement)), 0);
		};
		document.addEventListener("focusin", onIn);
		document.addEventListener("focusout", onOut);
		return () => {
			document.removeEventListener("focusin", onIn);
			document.removeEventListener("focusout", onOut);
		};
	}, []);

	// More on scroll.
	useEffect(() => {
		const target = sentinel.current;
		if (!target || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			// On the wall the next page is somebody else's to send; in the
			// vault it is already here and only the limit moves.
			if (tag) {
				if (!wallEnd) void readWall(lastPostId(wall));
				return;
			}
			setLimit((current) => current + PAGE);
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [results.length, tag, wall, wallEnd, readWall]);

	const open = useCallback((item: Item) => {
		// A phone runs no view transition, so nothing there needs naming for one.
		if (!Platform.isMobile) flushSync(() => setNamedId(item.id));
		void withTransition(() => setExpandedId(item.id));
	}, []);

	/** `keepFocus` false leaves the active pane alone: something else wants it. */
	const close = useCallback((keepFocus = true) => {
		// Blur first: a focused line in live preview shows its markup, and the
		// transition should start from the rendered text, not from `# title`.
		const focused = document.activeElement;
		if (focused instanceof HTMLElement) focused.blur();
		requestAnimationFrame(async () => {
			await withTransition(() => setExpandedId(null));
			setNamedId(null);
			if (!keepFocus) return;
			// The borrowed editor may have taken the active leaf with it.
			app.workspace.setActiveLeaf(leaf, { focus: true });
			/*
			 * That hands focus to the pane, not to anything inside it. The
			 * field has the cursor when the pane first opens, so it should
			 * have it again on the way back from a card — but not on a phone,
			 * where focus means the keyboard comes up uninvited.
			 */
			if (!Platform.isMobile) field.current?.focus();
		});
	}, [app, leaf]);

	const openPath = useCallback(
		(path: string) => {
			const file = app.vault.getAbstractFileByPath(path);
			const item = file ? index.itemFor(file) : undefined;
			if (item) {
				open(item);
				return;
			}
			void app.workspace.openLinkText(path, "", "tab");
		},
		[app, index, open]
	);

	/*
	 * A card's id is its path, so renaming the file renames the card. That
	 * happens while a card is open — the pane names a new note after its
	 * first line a moment after the typing stops — and the open card has to
	 * follow it, or the overlay is left holding an id the index has dropped
	 * and closes over the note being written.
	 */
	useEffect(() => {
		const ref = app.vault.on("rename", (file, oldPath) => {
			setExpandedId((id) => (id === oldPath ? file.path : id));
			setNamedId((id) => (id === oldPath ? file.path : id));
		});
		return () => app.vault.offref(ref);
	}, [app]);

	// Share intake and commands ask for a card.
	useEffect(
		() =>
			bus.on(({ path, expand }) => {
				setChips([]);
				setDraft("");
				const file = app.vault.getAbstractFileByPath(path);
				const item = file ? index.itemFor(file) : undefined;
				if (expand && item) open(item);
			}),
		[app, bus, index, open]
	);

	/** Cards for files that have just arrived drop into the grid, then settle. */
	const landed = useCallback((paths: string[]) => {
		if (paths.length === 0) return;
		setDropped(new Set(paths));
		window.setTimeout(() => setDropped(new Set()), 900);
	}, []);

	const take = useCallback(
		async (files: File[]) => {
			const written: string[] = [];
			let existing: string | null = null;
			for (const file of files) {
				const result = await ingest(app, index, settings, file, (duplicate) =>
					ask(app, {
						title: "Already in your vault",
						message: `“${file.name}” has the same contents as “${duplicate.title}”. Add it again anyway?`,
						confirm: "Add anyway",
						cancel: "Open the one I have",
					})
				);
				if (!result) continue;
				if (result.created) written.push(result.path);
				// Declined: the card the content already made is the answer.
				else existing = result.path;
			}
			landed(written);
			if (existing) {
				const file = app.vault.getAbstractFileByPath(existing);
				const item = file ? index.itemFor(file) : undefined;
				if (item) open(item);
			}
		},
		[app, index, settings, open, landed]
	);

	/** A long press or a right click: copy the card, or throw it away. */
	const itemMenu = useCallback(
		(item: Item, x: number, y: number) => {
			const menu = new Menu();
			// Somebody else's post is not ours to copy out of or throw away.
			if (item.remote) return;
			menu.addItem((entry) =>
				entry
					.setTitle("Copy")
					.setIcon("copy")
					.onClick(() => void copyItem(app, item))
			);
			menu.addItem((entry) =>
				entry
					.setTitle("Delete")
					.setIcon("trash-2")
					.onClick(async () => {
						const sure = await ask(app, {
							title: "Delete",
							message: `“${item.title}” goes to the trash, with its notes beside it.`,
							confirm: "Delete",
							cancel: "Keep it",
							destructive: true,
						});
						if (!sure) return;
						if (expandedId === item.id) close();
						// The sidecar is part of the card, so it goes too.
						if (item.sidecar) await app.fileManager.trashFile(item.sidecar);
						await app.fileManager.trashFile(item.file);
					})
			);
			menu.showAtPosition({ x, y });
		},
		[app, close, expandedId]
	);

	/** New note, or add files: the two ways in, on both platforms. */
	const plusMenu = useCallback(
		(event: React.MouseEvent) => {
			const menu = new Menu();
			menu.addItem((entry) =>
				entry
					.setTitle("New note")
					.setIcon("file-plus")
					.onClick(async () => {
						const file = await createNote(app, settings);
						const item = index.ensure(file);
						if (item) open(item);
					})
			);
			menu.addItem((entry) =>
				entry
					.setTitle("Add files")
					.setIcon("image-plus")
					.onClick(() => picker.current?.click())
			);
			menu.showAtMouseEvent(event.nativeEvent);
		},
		[app, index, settings, open]
	);

	const dismiss = useCallback(() => close(), [close]);

	/*
	 * An open card covers the pane, and Obsidian's editor takes dropped files
	 * itself: it writes them to the attachment folder and embeds them where
	 * the cursor is. Intake stays out of a drop that lands there, or the file
	 * arrives twice — once embedded, once as a card — and the hashes cannot
	 * tell, because Obsidian's copy carries no sidecar to hold one.
	 */
	const theirs = (event: React.DragEvent) =>
		event.target instanceof Element && event.target.closest(".skybox-overlay") !== null;

	const card = (item: Item) => {
		// A post on the wall is read where it is, and kept only if asked.
		if (item.remote) {
			return <WallOverlay item={item} onClose={close} />;
		}
		if (item.kind === "image") {
			return <Lightbox item={item} onClose={close} onOpenPath={openPath} />;
		}
		// A post kept from the wall is still somebody else's words, so it is
		// read as the post it was and not opened as markdown to edit.
		if (isKeptPost(app.metadataCache.getFileCache(item.file)?.frontmatter)) {
			return <WallOverlay item={item} onClose={close} />;
		}
		// A conversation is read as a conversation, not edited as a note.
		if (app.metadataCache.getFileCache(item.file)?.frontmatter?.thread_id) {
			return <MailOverlay item={item} onClose={close} onOpenPath={openPath} />;
		}
		return <NoteOverlay item={item} onClose={close} onOpenPath={openPath} />;
	};

	// The vault pages by moving a limit; the wall pages by asking for more, so
	// everything it has already been given is on screen.
	const shown = useMemo(
		() => (tag ? results : results.slice(0, limit)),
		[results, limit, tag]
	);
	const expanded = expandedId ? results.find((item) => item.id === expandedId) ?? index.get(expandedId) : undefined;

	return (
		<div
			className={`skybox-root${dropping ? " is-dropping" : ""}${
				typing ? " is-typing" : ""
			}`}
			onDragOver={(event) => {
				if (theirs(event)) return;
				event.preventDefault();
				setDropping(true);
			}}
			onDragLeave={(event) => {
				if (event.target === event.currentTarget) setDropping(false);
			}}
			onDrop={(event) => {
				if (theirs(event)) return;
				event.preventDefault();
				setDropping(false);
				void take([...event.dataTransfer.files]);
			}}
		>
			<div className="skybox-head">
				<div className="skybox-drag">
					<button
						className="skybox-settings"
						onClick={() => openPluginSettings(app, "skybox")}
					>
						settings
					</button>
				</div>
				<div className="skybox-bar">
					<SearchBox
						inputRef={field}
						chips={chips}
						draft={draft}
						onDraftChange={setDraft}
						onChipsChange={setChips}
					/>
					<button
						className={`skybox-plus${glowing ? " is-waiting" : ""}`}
						aria-label={glowing ? `${waiting} waiting on shared cards` : "Add"}
						onClick={(event) => {
							if (glowing) {
								showWaiting();
								return;
							}
							// A phone has no drag and drop and little room, so
							// it keeps the menu; a desktop gets the box.
							if (Platform.isMobile) plusMenu(event);
							else setComposing(true);
						}}
						onContextMenu={(event) => {
							event.preventDefault();
							plusMenu(event);
						}}
					>
						+
					</button>
				</div>
			</div>

			{shown.length === 0 ? (
				<p className="skybox-empty">nothing here</p>
			) : (
				<Masonry items={shown}>
					{(item, position) => (
						<Card
							item={item}
							index={position}
							named={namedId === item.id && expandedId !== item.id}
							fresh={fresh.has(item.id)}
							dropped={dropped.has(item.id)}
							onOpen={open}
							onMenu={itemMenu}
						/>
					)}
				</Masonry>
			)}
			<div className="skybox-sentinel" ref={sentinel} />

			<input
				ref={picker}
				className="skybox-picker"
				type="file"
				multiple
				accept="image/*,.md"
				onChange={(event) => {
					void take([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
			/>

			{composing && !Platform.isMobile && (
				<Composer onClose={() => setComposing(false)} onOpenPath={openPath} />
			)}

			{expanded &&
				(Platform.isMobile ? <Sheet onClose={dismiss}>{card(expanded)}</Sheet> : card(expanded))}

			{Platform.isMobile && (
				<button
					className={`skybox-standalone-toggle${settings.standalone ? " is-on" : ""}`}
					aria-label={settings.standalone ? "Leave standalone mode" : "Standalone mode"}
					onClick={() => void setStandalone(!settings.standalone)}
				>
					<Icon name={settings.standalone ? "minimize" : "maximize"} />
				</button>
			)}

			{Platform.isMobile && <BottomBar />}
		</div>
	);
}
