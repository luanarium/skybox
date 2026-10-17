import * as assert from "node:assert";
import { applyScopedTheme, forgetScopedTheme } from "../src/theme";

/** A stand-in for how Obsidian declares its colours. */
class Rule {
	constructor(
		public selectorText: string,
		private declarations: Record<string, string>
	) {}
	style = {
		length: 0,
		item: (index: number) => Object.keys(this.declarations)[index] ?? "",
		getPropertyValue: (property: string) => this.declarations[property] ?? "",
	};
	init() {
		this.style.length = Object.keys(this.declarations).length;
		return this;
	}
}

(globalThis as { CSSStyleRule?: unknown }).CSSStyleRule = Rule;

const sheets = [
	{
		cssRules: [
			new Rule(".theme-dark", { "--color-base-00": "#1C1C1C", "--mono-100": "white" }).init(),
			new Rule(".theme-light", { "--color-base-00": "#ffffff", "--mono-100": "black" }).init(),
			new Rule("body", {
				"--background-primary": "var(--color-base-00)",
				"--card-back": "var(--background-primary)",
				"--font-text-size": "16px",
			}).init(),
			new Rule(".some-other-rule", { "--ignored": "var(--color-base-00)" }).init(),
		],
	},
	{
		// A stylesheet the page cannot read must not stop the walk.
		get cssRules(): never {
			throw new Error("cross-origin");
		},
	},
];

const style = { id: "", textContent: "", remove: () => undefined };
(globalThis as Record<string, unknown>).document = {
	styleSheets: sheets,
	getElementById: () => null,
	createElement: () => style,
	head: { appendChild: () => undefined },
};

forgetScopedTheme();
applyScopedTheme("light");

assert.match(style.textContent, /^\.skybox-content\.theme-light,\n\.skybox-sheet\.theme-light \{/);
assert.match(style.textContent, /--color-base-00: #ffffff;/, "the chosen palette is re-declared");
assert.match(
	style.textContent,
	/--background-primary: var\(--color-base-00\);/,
	"and so is every name that leans on it, to be recomputed"
);
assert.match(
	style.textContent,
	/--card-back: var\(--background-primary\);/,
	"however many names deep"
);
assert.doesNotMatch(style.textContent, /--font-text-size/, "sizes have nothing to do with it");
assert.doesNotMatch(style.textContent, /--ignored/, "and nor has anything outside the theme");

