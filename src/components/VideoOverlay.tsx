import { useEffect } from "react";
import { ItemView, Platform } from "obsidian";
import { useSkybox } from "../context";
import type { Item } from "../types";
import { watchUrl } from "../video";
import { Icon } from "./Icon";
import { MetadataBox } from "./MetadataBox";
import { VideoComments } from "./VideoComments";
import { useDismiss } from "./Sheet";
import { Frame } from "./Frame";

/**
 * A bookmarked video, opened as the video.
 *
 * A watch page has no article to clip, so a card that opens into markdown
 * shows a heading, a link and the raw `iframe` the clipper left behind, which
 * is everything except the thing the page is about. Here the player is the
 * first thing and the only thing above it is the card's own properties: what
 * the page said about itself goes underneath, where a description belongs.
 *
 * The player is YouTube's, loaded from youtube-nocookie.com when the card is
 * opened and never before, and the setting that turns it off leaves a link.
 */
export function VideoOverlay({
	item,
	id,
	onClose,
	onOpenPath,
}: {
	item: Item;
	/** The video this note points at, already read out of its source. */
	id: string;
	onClose: (keepFocus?: boolean) => void;
	onOpenPath: (path: string) => void;
}) {
	const { app, leaf, settings } = useSkybox();
	const dismiss = useDismiss(onClose);
	const front = app.metadataCache.getFileCache(item.file)?.frontmatter ?? {};
	const description = typeof front.description === "string" ? front.description.trim() : "";
	const site = typeof front.site === "string" ? front.site.trim() : "";

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	/** Opens the note in its own tab, carrying a way back to the grid. */
	const openInObsidian = async () => {
		const target = app.workspace.getLeaf("tab");
		await target.openFile(item.file);
		const view = target.view;
		if (view instanceof ItemView) {
			view.addAction("layout-grid", "Back to Skybox", () => {
				void app.workspace.revealLeaf(leaf);
				app.workspace.setActiveLeaf(leaf, { focus: true });
			});
		}
		onClose(false);
	};

	return (
		<div
			className="skybox-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="skybox-expanded skybox-video">
				<header className="skybox-expanded-head">
					{Platform.isMobile && (
						<button
							className="skybox-back-arrow"
							aria-label="Back to the grid"
							onClick={() => dismiss()}
						>
							<Icon name="arrow-left" />
						</button>
					)}
					<h2>{item.title}</h2>
					<div className="skybox-expanded-actions">
						{!Platform.isMobile && (
							<button onClick={() => void openInObsidian()}>Open in Obsidian</button>
						)}
						{!Platform.isMobile && (
							<button className="skybox-close" aria-label="Close" onClick={() => onClose()}>
								×
							</button>
						)}
					</div>
				</header>
				<div className="skybox-expanded-body">
					<div className="skybox-video-main">
						{settings.videoEmbeds ? (
							<Frame id={id} title={item.title} />
						) : (
							<p className="skybox-video-off">
								Playing videos in a card is switched off.{" "}
								<a href={watchUrl(id)}>Watch it on YouTube</a>.
							</p>
						)}

						{description ? (
							<p className="skybox-video-description">{description}</p>
						) : (
							<p className="skybox-meta-none">
								no description was saved with this one
							</p>
						)}
						<p className="skybox-video-where">
							<a href={watchUrl(id)}>{site || "YouTube"}</a>
						</p>
						{settings.videoComments && <VideoComments id={id} />}
					</div>
					<MetadataBox
						note={item.file}
						file={item.file}
						tags={item.tags}
						onOpenPath={onOpenPath}
					/>
				</div>
			</div>
		</div>
	);
}
