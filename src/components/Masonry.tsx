import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import {
	columnsFor,
	estimateHeight,
	MARGIN,
	ROW_HEIGHT,
	rowsFor,
	shortestColumnCompactor,
} from "../compact";
import { Platform } from "obsidian";
import { useTelegrid } from "../context";
import type { Item } from "../types";

interface MasonryProps {
	items: Item[];
	children: (item: Item, index: number) => React.ReactNode;
}

export function Masonry({ items, children }: MasonryProps) {
	const { settings } = useTelegrid();
	const { width, mounted, containerRef } = useContainerWidth({
		measureBeforeMount: true,
		debounceTimeout: 60,
	});
	const [heights, setHeights] = useState<Record<string, number>>({});
	const observer = useRef<ResizeObserver | null>(null);
	const ids = useRef(new WeakMap<Element, string>());
	const cells = useRef(new Map<string, HTMLDivElement>());

	// The observer lives in an effect so a remount re-observes the cards.
	useEffect(() => {
		if (typeof ResizeObserver === "undefined") return;
		const watcher = new ResizeObserver((entries) => {
			setHeights((previous) => {
				let next = previous;
				for (const entry of entries) {
					const id = ids.current.get(entry.target);
					if (!id) continue;
					const height = Math.ceil(entry.target.scrollHeight);
					if (!height || previous[id] === height) continue;
					if (next === previous) next = { ...previous };
					next[id] = height;
				}
				return next;
			});
		});
		observer.current = watcher;
		for (const cell of cells.current.values()) watcher.observe(cell);
		return () => {
			watcher.disconnect();
			observer.current = null;
		};
	}, []);

	const measure = useCallback(
		(id: string) => (element: HTMLDivElement | null) => {
			if (!element) return;
			ids.current.set(element, id);
			cells.current.set(id, element);
			observer.current?.observe(element);
		},
		[]
	);

	// Cards that have left the results stop being watched.
	useEffect(() => {
		const live = new Set(items.map((item) => item.id));
		for (const [id, cell] of cells.current) {
			if (live.has(id)) continue;
			observer.current?.unobserve(cell);
			cells.current.delete(id);
		}
	}, [items]);

	const order = useMemo(
		() => new Map(items.map((item, position) => [item.id, position])),
		[items]
	);
	const compactor = useMemo(() => shortestColumnCompactor(order), [order]);
	const asked =
		Platform.isMobile && settings.mobileColumns !== "auto"
			? Number(settings.mobileColumns)
			: undefined;
	const cols = columnsFor(width, asked);

	const layout = useMemo<Layout>(
		() =>
			items.map((item, position) => ({
				i: item.id,
				x: 0,
				y: position,
				w: 1,
				h: rowsFor(heights[item.id] ?? estimateHeight(item)),
			})),
		[items, heights]
	);

	return (
		<div className="telegrid-grid" ref={containerRef as React.RefObject<HTMLDivElement>}>
			{mounted && (
				<GridLayout
					width={width}
					layout={layout}
					compactor={compactor}
					gridConfig={{
						cols,
						rowHeight: ROW_HEIGHT,
						margin: MARGIN,
						containerPadding: [0, 0],
					}}
					dragConfig={{ enabled: false }}
					resizeConfig={{ enabled: false }}
					autoSize
				>
					{items.map((item, position) => (
						<div key={item.id} className="telegrid-cell">
							<div className="telegrid-cell-inner" ref={measure(item.id)}>
								{children(item, position)}
							</div>
						</div>
					))}
				</GridLayout>
			)}
		</div>
	);
}
