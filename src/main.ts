import { Platform, Plugin, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { isBorrowing } from "./borrowed";
import { Bus } from "./bus";
import { VaultIndex } from "./index";
import { TelegridSettingTab } from "./settings";
import { ShareIntake } from "./share";
import { DEFAULT_SETTINGS, VIEW_TYPE_TELEGRID, type TelegridSettings } from "./types";
import { TelegridView } from "./view";
import { hasWindowHandle, startWindowDrag, toggleMaximize } from "./window";

export default class TelegridPlugin extends Plugin {
	settings: TelegridSettings = { ...DEFAULT_SETTINGS };
	index!: VaultIndex;
	bus!: Bus;
	private share!: ShareIntake;
	private backEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new VaultIndex(this.app);
		this.bus = new Bus();
		this.share = new ShareIntake(
			this.app,
			this.index,
			this.bus,
			this.settings,
			async () => {
				await this.open();
			}
		);

		this.registerView(VIEW_TYPE_TELEGRID, (leaf) => new TelegridView(leaf, this));

		this.addRibbonIcon("layout-grid", "Telegrid", () => void this.open());
		this.addCommand({
			id: "open-telegrid",
			name: "Open Telegrid",
			callback: () => void this.open(),
		});

		this.addSettingTab(new TelegridSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.index.build();
			// Registered here: the vault fires create for every file at load.
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					this.index.onCreate(file);
					if (file instanceof TFile) this.share.onVaultWrite(file);
				})
			);
			this.registerEvent(
				this.app.vault.on("modify", (file) => {
					this.index.onModify(file);
					if (file instanceof TFile) this.share.onVaultWrite(file);
				})
			);
			this.registerEvent(this.app.vault.on("delete", (file) => this.index.onDelete(file)));
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => this.index.onRename(file, oldPath))
			);
			this.registerEvent(
				this.app.metadataCache.on("changed", (file) => this.index.onModify(file))
			);
			// Tags and headings read as empty until the cache has resolved, so
			// the index is taken again once it has.
			this.registerEvent(this.app.metadataCache.on("resolved", () => this.index.build()));
			this.register(this.share.watchForeground());
			this.mountBack();
			this.watchTopBar();

			void this.start();
		});
	}

	onunload(): void {
		document.body.removeClass("telegrid-standalone");
		document.body.removeClass("telegrid-top-edge");
		document.body.removeClass("telegrid-window");
	}

	/** Open on startup, standalone mode, and whatever the share sheet just sent. */
	private async start(): Promise<void> {
		this.applyStandalone();
		if (this.settings.standalone) {
			await this.standalone();
		} else if (this.settings.openOnStartup) {
			await this.open();
		}
		if (Platform.isMobile) this.share.coldStart();
	}

	/**
	 * Reveal the search pane. If it is not up — Obsidian opened a shared note
	 * in the main leaf, say — that leaf is reset to the search view.
	 */
	async open(): Promise<WorkspaceLeaf> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TELEGRID);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			// Revealing alone leaves the pane unfocused, and whatever the
			// reader was in still counts as the active leaf.
			this.app.workspace.setActiveLeaf(existing[0], { focus: true });
			this.updateBack();
			return existing[0];
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE_TELEGRID, active: true });
		this.app.workspace.revealLeaf(leaf);
		this.updateBack();
		return leaf;
	}

	/**
	 * Obsidian launches into the plugin: the grid takes the main leaf and
	 * nothing else is left open. The grid goes up first and the other leaves
	 * go after, because a root split with nothing in it is where Obsidian puts
	 * an empty tab of its own — the new note / new canvas / go to file screen
	 * that was turning up instead of the grid.
	 */
	private async standalone(): Promise<void> {
		const leaf = await this.open();
		this.keepOnly(leaf);
		// The restored layout can still settle a tab in beside the grid, so
		// the empty ones are swept once more as it does.
		const timers = [250, 1000].map((delay) =>
			window.setTimeout(() => this.keepOnly(leaf, "empty"), delay)
		);
		this.register(() => timers.forEach((timer) => window.clearTimeout(timer)));
	}

	/** Detaches the other root leaves, or only the ones of a given view type. */
	private keepOnly(keep: WorkspaceLeaf, type?: string): void {
		const others: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf === keep) return;
			if (type && leaf.view.getViewType() !== type) return;
			others.push(leaf);
		});
		if (others.length === 0) return;
		for (const leaf of others) leaf.detach();
		this.app.workspace.revealLeaf(keep);
		this.app.workspace.setActiveLeaf(keep, { focus: true });
	}

	applyStandalone(): void {
		document.body.toggleClass("telegrid-standalone", this.settings.standalone);
		// With a window handle the drag band moves the window itself, so it
		// must keep its clicks rather than becoming a CSS drag region.
		document.body.toggleClass("telegrid-window", hasWindowHandle());
		this.updateBack();
	}

	/**
	 * Standalone mode hides the ribbon and the tab bar, so a note opened in
	 * Obsidian would have no way back. This is it: a pill in the corner,
	 * shown whenever the grid is up but something else is in front of it.
	 */
	private mountBack(): void {
		const el = document.body.createDiv({ cls: "telegrid-back" });
		const button = el.createEl("button", { attr: { "aria-label": "Back to Telegrid" } });
		setIcon(button.createSpan({ cls: "telegrid-back-icon" }), "layout-grid");
		button.createSpan({ text: "Telegrid" });
		button.addEventListener("click", () => void this.open());
		this.backEl = el;
		this.register(() => {
			el.remove();
			this.backEl = null;
		});
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.updateBack())
		);
		this.registerEvent(this.app.workspace.on("layout-change", () => this.updateBack()));
		this.updateBack();
	}

	private updateBack(): void {
		const el = this.backEl;
		if (!el) return;
		const up = this.app.workspace.getLeavesOfType(VIEW_TYPE_TELEGRID).length > 0;
		// A borrowed editor is the grid, expanded — not somewhere else.
		const back = this.app.workspace.getActiveViewOfType(TelegridView) !== null || isBorrowing();
		el.toggleClass("is-visible", this.settings.standalone && up && !back);
	}

	/**
	 * The top band of the window, where a titlebar would be: the window
	 * buttons wait there out of sight, dragging it moves the window and
	 * double-clicking it maximizes. Whatever sits in that band — the drag
	 * band, a view header, the titlebar overlay — all of it answers, which is
	 * why this listens on the document rather than on one element.
	 */
	private watchTopBar(): void {
		let near = false;

		const inBand = (event: MouseEvent): boolean => {
			if (!this.settings.standalone) return false;
			if (event.clientY > topEdge()) return false;
			const target = event.target;
			// Never over something the reader is aiming at.
			return !(target instanceof Element && target.closest(HANDS_OFF));
		};

		const onMove = (event: MouseEvent) => {
			if (!this.settings.standalone) return;
			const within = event.clientY <= topEdge();
			if (within === near) return;
			near = within;
			document.body.toggleClass("telegrid-top-edge", near);
		};

		const onDown = (event: MouseEvent) => {
			if (inBand(event)) startWindowDrag(event);
		};

		const onDouble = (event: MouseEvent) => {
			if (inBand(event)) toggleMaximize();
		};

		document.addEventListener("mousemove", onMove, { passive: true });
		document.addEventListener("mousedown", onDown);
		document.addEventListener("dblclick", onDouble);
		this.register(() => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("dblclick", onDouble);
			document.body.removeClass("telegrid-top-edge");
		});
	}

	private async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TELEGRID)) {
			const view = leaf.view;
			if (view instanceof TelegridView) view.render();
		}
	}
}

/** Anything in the top band that is there to be clicked, not dragged. */
const HANDS_OFF = [
	"button",
	"a",
	"input",
	"textarea",
	".clickable-icon",
	".titlebar-button",
	".view-action",
	".view-header-nav-buttons",
	".menu",
	".telegrid-chip",
	".telegrid-search",
].join(", ");

/** The band at the top of the window that brings the window buttons back. */
function topEdge(): number {
	const declared = Number.parseFloat(
		getComputedStyle(document.body).getPropertyValue("--titlebar-height")
	);
	return Number.isFinite(declared) && declared > 0 ? Math.max(declared, 24) : 32;
}
