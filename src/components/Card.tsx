import { useEffect, useRef, useState } from "react";
import { useSkybox } from "../context";
import { coverClass, coverVars } from "../cover";
import { plainExcerpt } from "../search";
import type { Item } from "../types";

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
	onOpen: (item: Item) => void;
	/** A long press, or a right click: what can be done with this one. */
	onMenu: (item: Item, x: number, y: number) => void;
}

export function Card({ item, index, named, fresh, dropped, onOpen, onMenu }: CardProps) {
	const { app, index: vaultIndex, settings } = useSkybox();
	const [excerpt, setExcerpt] = useState("");

	useEffect(() => {
		let current = true;
		if (item.kind === "note" || item.sidecar) {
			vaultIndex.content(item).then((content) => {
				if (current) setExcerpt(plainExcerpt(content));
			});
		} else {
			setExcerpt("");
		}
		return () => {
			current = false;
		};
	}, [item.id, item.mtime, vaultIndex]);

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

	const style = {
		animationDelay: `${Math.min(index, 20) * 24}ms`,
		viewTransitionName: named ? "skybox-expanding" : undefined,
	} as React.CSSProperties;

	return (
		<div
			className={`skybox-card is-${item.kind}${fresh ? " is-fresh" : ""}${
				dropped ? " is-dropped" : ""
			}`}
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
			{item.kind === "note" && settings.coverArt && (
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
			<div className="skybox-card-body">
				<div className="skybox-card-title">{item.title}</div>
				{excerpt && <div className="skybox-card-excerpt">{excerpt}</div>}
				{item.tags.length > 0 && (
					<div className="skybox-card-tags">
						{item.tags.slice(0, 4).map((tag) => (
							<span className="skybox-tag" key={tag}>
								#{tag}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
