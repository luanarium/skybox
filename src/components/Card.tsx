import { useEffect, useRef, useState } from "react";
import { type App, TFile } from "obsidian";
import { useSkybox } from "../context";
import { coverClass, coverVars } from "../cover";
import { bodyImage, webImage } from "../preview";
import type { Item, SkyboxSettings } from "../types";

interface CardProps {
	item: Item;
	/** Position in the results, for the staggered fade-in. */
	index: number;
	/** Carries the shared view-transition name while this card expands. */
	named: boolean;
	/** Newly surfaced by the current chip set, so it fades in. */
	fresh: boolean;
	/** Just arrived, so it drops in. */
	dropped: boolean;
	/** A drag is over this card, so a picture dropped now goes into it. */
	targeted: boolean;
	/** Chips are in the box, so a card says what put it here. */
	searching: boolean;
	onOpen: (item: Item) => void;
	/** A long press, or a right click: what can be done with this one. */
	onMenu: (item: Item, x: number, y: number) => void;
}

export function Card({
	item,
	index,
	named,
	fresh,
	dropped,
	targeted,
	searching,
	onOpen,
	onMenu,
}: CardProps) {
	const { app, index: vaultIndex, settings } = useSkybox();
	/** A picture found in the note's own text, as the note wrote it. */
	const [written, setWritten] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		// A post has no file to read, and an image's picture is itself.
		if (!item.remote && item.kind === "note") {
			vaultIndex.content(item).then((content) => {
				if (current) setWritten(bodyImage(content));
			});
		} else {
			setWritten(null);
		}
		return () => {
			current = false;
		};
	}, [item.id, item.mtime, item.remote, item.kind, vaultIndex]);

	const held = useRef<number | null>(null);
	const wasHeld = useRef(false);

	const hold = (x: number, y: number) => {
		wasHeld.current = false;
		held.current = window.setTimeout(() => {
			wasHeld.current = true;
			held.current = null;
			onMenu(item, x, y);
		}, 450);
	};

	const letGo = () => {
		if (held.current === null) return;
		window.clearTimeout(held.current);
		held.current = null;
	};

	// What the card draws: a picture the note holds beats one the page merely
	// offered, and resolving it here rather than in the effect means the
	// preview-images setting takes hold the moment it is switched.
	const own = textPicture(app, settings, item, written);
	// A card from a hashtag wall is the picture: the words are in the post,
	// the hashtag is the search that found it, and a column of cards all
	// repeating it is a column of cards nobody can see. A post with no
	// picture still has to say something, so that one keeps its words.
	const picture = own && (!item.preview || item.previewOffered) ? own : item.preview;

	const style = {
		animationDelay: `${Math.min(index, 20) * 24}ms`,
		viewTransitionName: named ? "skybox-expanding" : undefined,
	} as React.CSSProperties;

	return (
		<div
			className={`skybox-card is-${item.kind}${fresh ? " is-fresh" : ""}${
				dropped ? " is-dropped" : ""
			}${targeted ? " is-target" : ""}${item.remote ? " is-wall" : ""}`}
			data-skybox-id={item.id}
			style={style}
			role="button"
			tabIndex={0}
			onClick={() => {
				// The press that opened the menu is not also a tap.
				if (wasHeld.current) {
					wasHeld.current = false;
					return;
				}
				onOpen(item);
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				onMenu(item, event.clientX, event.clientY);
			}}
			onTouchStart={(event) => {
				const touch = event.touches[0];
				if (touch) hold(touch.clientX, touch.clientY);
			}}
			onTouchMove={letGo}
			onTouchEnd={letGo}
			onTouchCancel={letGo}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen(item);
				}
			}}
		>
			{item.kind === "note" && picture && (
				<img
					className="skybox-card-image skybox-card-preview"
					src={picture}
					alt=""
					loading="lazy"
				/>
			)}
			{item.kind === "note" && !picture && settings.coverArt && (
				// Decoration, not content: the title below says what this is.
				<div
					className={coverClass(item.id)}
					style={coverVars(item.id) as React.CSSProperties}
					aria-hidden="true"
				/>
			)}
			{item.kind === "image" && (
				<img
					className="skybox-card-image"
					src={app.vault.getResourcePath(item.file)}
					alt={item.title}
					loading="lazy"
					draggable={false}
				/>
			)}
			{!(item.remote && picture) && (
				<div className="skybox-card-body">
					<div className="skybox-card-title">{item.title}</div>
					{/*
					 * Tags while a search is on, and not otherwise. They are what
					 * says why a card is in these results; on the everything view
					 * they are a line of noise under every title.
					 */}
					{searching && !item.remote && item.tags.length > 0 && (
						<div className="skybox-card-tags">
							{item.tags.slice(0, 4).map((tag) => (
								<span className="skybox-tag" key={tag}>
									#{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * A picture the note's text pointed at, ready for an `img`. An address is
 * loaded from wherever it lives, so it waits on the same setting as a picture
 * fetched for a bookmark: with that off, nothing in a card reaches a host
 * nobody asked it to. A path is resolved the way Obsidian would resolve it,
 * which also covers the moment before the cache has caught up with a new
 * embed.
 */
function textPicture(
	app: App,
	settings: SkyboxSettings,
	item: Item,
	reference: string | null
): string | null {
	if (!reference) return null;
	const address = webImage(reference);
	if (address) return settings.bookmarkImages ? address : null;
	const target = app.metadataCache.getFirstLinkpathDest(reference, item.file.path);
	return target instanceof TFile ? app.vault.getResourcePath(target) : null;
}
