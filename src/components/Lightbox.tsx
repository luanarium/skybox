import { useEffect, useRef, useState } from "react";
import { Platform, type TFile } from "obsidian";
import { useTelegrid } from "../context";
import { ensureSidecar, readBody, writeBody } from "../sidecar";
import type { Item } from "../types";
import { Icon } from "./Icon";
import { useDismiss } from "./Sheet";
import { MetadataBox } from "./MetadataBox";

const SAVE_DELAY = 600;

interface LightboxProps {
	item: Item;
	onClose: (keepFocus?: boolean) => void;
	onOpenPath: (path: string) => void;
}

/** An image opens as a lightbox: tags beside it, thoughts below. */
export function Lightbox({ item, onClose, onOpenPath }: LightboxProps) {
	const { app } = useTelegrid();
	// Inside a sheet, closing means letting the sheet slide away.
	const dismiss = useDismiss(onClose);
	const [thoughts, setThoughts] = useState("");
	const [loaded, setLoaded] = useState(false);
	const timer = useRef<number | null>(null);
	const touched = useRef<string | null>(null);

	useEffect(() => {
		let current = true;
		// A sidecar written from this textarea must not read itself back over
		// what is still being typed.
		if (touched.current === item.id) return;
		setLoaded(false);
		if (item.sidecar) {
			void readBody(app, item.sidecar).then((body) => {
				if (!current) return;
				setThoughts(body.replace(/^\n+/, ""));
				setLoaded(true);
			});
		} else {
			setThoughts("");
			setLoaded(true);
		}
		return () => {
			current = false;
		};
	}, [app, item.id, item.sidecar?.path]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[]
	);

	const sidecar = async (): Promise<TFile> => ensureSidecar(app, item.file);

	const onThoughts = (value: string) => {
		touched.current = item.id;
		setThoughts(value);
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			void sidecar().then((note) => writeBody(app, note, value.endsWith("\n") ? value : `${value}\n`));
		}, SAVE_DELAY);
	};

	return (
		<div
			className="telegrid-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="telegrid-expanded is-lightbox">
				<header className="telegrid-expanded-head">
					{Platform.isMobile && (
						<button
							className="telegrid-back-arrow"
							aria-label="Back to the grid"
							onClick={() => dismiss()}
						>
							<Icon name="arrow-left" />
						</button>
					)}
					<h2>{item.title}</h2>
					<div className="telegrid-expanded-actions">
						{/* The arrow and the back gesture are the phone's way out. */}
						{!Platform.isMobile && (
							<button className="telegrid-close" aria-label="Close" onClick={() => onClose()}>
								×
							</button>
						)}
					</div>
				</header>
				<div className="telegrid-expanded-body">
					<div className="telegrid-lightbox-main">
						<img
							className="telegrid-lightbox-image"
							src={app.vault.getResourcePath(item.file)}
							alt={item.title}
						/>
						<textarea
							className="telegrid-thoughts"
							placeholder="thoughts and annotations"
							value={thoughts}
							disabled={!loaded}
							onChange={(event) => onThoughts(event.target.value)}
						/>
					</div>
					<MetadataBox
						note={item.sidecar}
						file={item.file}
						tags={item.tags}
						onOpenPath={onOpenPath}
						ensureNote={sidecar}
					/>
				</div>
			</div>
		</div>
	);
}
