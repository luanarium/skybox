import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Menu, Platform } from "obsidian";
import { ask } from "./confirm";
import { useTelegrid } from "./context";
import { createNote, ingest } from "./ingest";
import { type Chip, search } from "./search";
import { withTransition } from "./transition";
import type { Item } from "./types";
import { Card } from "./components/Card";
import { Lightbox } from "./components/Lightbox";
import { Masonry } from "./components/Masonry";
import { NoteOverlay } from "./components/NoteOverlay";
import { Sheet } from "./components/Sheet";
import { SearchBox } from "./components/SearchBox";

const PAGE = 100;

export function App() {
	const { app, index, settings, bus, leaf } = useTelegrid();
	const [chips, setChips] = useState<Chip[]>([]);
	const [draft, setDraft] = useState("");
	const [version, setVersion] = useState(0);
	const [results, setResults] = useState<Item[]>([]);
	const [limit, setLimit] = useState(PAGE);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [namedId, setNamedId] = useState<string | null>(null);
	const [dropping, setDropping] = useState(false);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const seen = useRef(new Set<string>());
	const sentinel = useRef<HTMLDivElement>(null);
	const picker = useRef<HTMLInputElement>(null);

	useEffect(() => index.subscribe(() => setVersion((n) => n + 1)), [index]);

	useEffect(() => {
		let current = true;
		void search(index, chips).then((found) => {
			if (!current) return;
			setResults(found);
			const ids = new Set(found.map((item) => item.id));
			setFresh(new Set([...ids].filter((id) => !seen.current.has(id))));
			seen.current = ids;
		});
		return () => {
			current = false;
		};
	}, [index, chips, version]);

	useEffect(() => setLimit(PAGE), [chips]);

	// More on scroll.
	useEffect(() => {
		const target = sentinel.current;
		if (!target || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setLimit((current) => current + PAGE);
			}
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [results.length]);

	const open = useCallback((item: Item) => {
		flushSync(() => setNamedId(item.id));
		void withTransition(() => setExpandedId(item.id));
	}, []);

	/** `keepFocus` false leaves the active pane alone: something else wants it. */
	const close = useCallback((keepFocus = true) => {
		// Blur first: a focused line in live preview shows its markup, and the
		// transition should start from the rendered text, not from `# title`.
		const focused = document.activeElement;
		if (focused instanceof HTMLElement) focused.blur();
		requestAnimationFrame(() => {
			void withTransition(() => setExpandedId(null)).then(() => {
				setNamedId(null);
				// The borrowed editor may have taken the active leaf with it.
				if (keepFocus) app.workspace.setActiveLeaf(leaf, { focus: true });
			});
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

	const take = useCallback(
		async (files: File[]) => {
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
				// Declined: the card the content already made is the answer.
				if (result && !result.created) existing = result.path;
			}
			if (existing) {
				const file = app.vault.getAbstractFileByPath(existing);
				const item = file ? index.itemFor(file) : undefined;
				if (item) open(item);
			}
		},
		[app, index, settings, open]
	);

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

	const card = (item: Item) =>
		item.kind === "image" ? (
			<Lightbox item={item} onClose={close} onOpenPath={openPath} />
		) : (
			<NoteOverlay item={item} onClose={close} onOpenPath={openPath} />
		);

	const shown = useMemo(() => results.slice(0, limit), [results, limit]);
	const expanded = expandedId ? results.find((item) => item.id === expandedId) ?? index.get(expandedId) : undefined;

	return (
		<div
			className={`telegrid-root${dropping ? " is-dropping" : ""}`}
			onDragOver={(event) => {
				event.preventDefault();
				setDropping(true);
			}}
			onDragLeave={(event) => {
				if (event.target === event.currentTarget) setDropping(false);
			}}
			onDrop={(event) => {
				event.preventDefault();
				setDropping(false);
				void take([...event.dataTransfer.files]);
			}}
		>
			<div className="telegrid-drag" />

			<SearchBox
				chips={chips}
				draft={draft}
				onDraftChange={setDraft}
				onChipsChange={setChips}
			/>

			{shown.length === 0 ? (
				<p className="telegrid-empty">nothing here</p>
			) : (
				<Masonry items={shown}>
					{(item, position) => (
						<Card
							item={item}
							index={position}
							named={namedId === item.id && expandedId !== item.id}
							fresh={fresh.has(item.id)}
							onOpen={open}
						/>
					)}
				</Masonry>
			)}
			<div className="telegrid-sentinel" ref={sentinel} />

			<button className="telegrid-plus" aria-label="Add" onClick={plusMenu}>
				+
			</button>
			<input
				ref={picker}
				className="telegrid-picker"
				type="file"
				multiple
				accept="image/*,.md"
				onChange={(event) => {
					void take([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
			/>

			{expanded && (Platform.isMobile ? <Sheet onClose={dismiss}>{card(expanded)}</Sheet> : card(expanded))}
		</div>
	);
}
