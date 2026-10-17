/**
 * Dressing the pane in the other theme.
 *
 * `.theme-dark` and `.theme-light` carry the palette — the `--color-base-*`
 * ramp and its neighbours — but the names everything is drawn with are
 * declared on `body` in terms of that ramp. A declaration like
 * `--background-primary: var(--color-base-00)` is resolved where it is
 * written, so it reaches the pane already decided and swapping the ramp
 * underneath it changes nothing.
 *
 * So the names have to be declared again, inside the pane. Rather than pin a
 * copy of Obsidian's mappings into the stylesheet, they are read back out of
 * the live stylesheets: whatever this Obsidian and this theme declare on
 * `body`, and whatever depends on the ramp, is re-declared for the pane and
 * recomputed from the ramp the pane now has.
 */
const STYLE_ID = "skybox-scoped-theme";

const cache = new Map<string, string>();

export function applyScopedTheme(mode: "follow" | "dark" | "light"): void {
	document.getElementById(STYLE_ID)?.remove();
	if (mode === "follow") return;

	let declarations = cache.get(mode);
	if (declarations === undefined) {
		declarations = scopedDeclarations(mode);
		cache.set(mode, declarations);
	}
	if (!declarations) return;

	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent =
		`.skybox-content.theme-${mode},\n.skybox-sheet.theme-${mode} {\n${declarations}}\n`;
	document.head.appendChild(style);
}

/** Forget what the stylesheets said, after a theme or snippet changes. */
export function forgetScopedTheme(): void {
	cache.clear();
}

function scopedDeclarations(mode: "dark" | "light"): string {
	const wanted = `theme-${mode}`;
	const other = mode === "dark" ? "theme-light" : "theme-dark";
	/** Names the theme blocks set: the palette the pane is to recompute from. */
	const palette = new Set<string>();
	/** Names to re-declare outright, from the chosen theme's own blocks. */
	const chosen = new Map<string, string>();
	/** Names declared for the document as a whole, in terms of something else. */
	const derived = new Map<string, string>();

	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			// A stylesheet the page may not read; nothing to take from it.
			continue;
		}
		for (const rule of Array.from(rules)) {
			if (!(rule instanceof CSSStyleRule)) continue;
			const selector = rule.selectorText;
			const forWanted = selector.includes(wanted);
			const forOther = selector.includes(other);
			const forDocument = /(^|,)\s*(body|html|:root)\s*(,|$)/.test(selector);
			if (!forWanted && !forOther && !forDocument) continue;

			for (let index = 0; index < rule.style.length; index++) {
				const property = rule.style.item(index);
				if (!property.startsWith("--")) continue;
				const value = rule.style.getPropertyValue(property).trim();
				if (forWanted || forOther) {
					palette.add(property);
					if (forWanted) chosen.set(property, value);
				} else {
					derived.set(property, value);
				}
			}
		}
	}

	if (chosen.size === 0) return "";

	// Anything leaning on the palette, however many names deep.
	const carried = new Set<string>();
	for (let settled = false; !settled; ) {
		settled = true;
		for (const [property, value] of derived) {
			if (carried.has(property)) continue;
			if (references(value).some((name) => palette.has(name) || carried.has(name))) {
				carried.add(property);
				settled = false;
			}
		}
	}

	const lines: string[] = [];
	for (const [property, value] of chosen) lines.push(`\t${property}: ${value};`);
	for (const property of carried) lines.push(`\t${property}: ${derived.get(property)};`);
	return `${lines.join("\n")}\n`;
}

function references(value: string): string[] {
	return [...value.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((match) => match[1]);
}
