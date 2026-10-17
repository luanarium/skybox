import { Icon } from "./Icon";

/** Not wired up yet: the places the grid will grow into. */
const PLACES = [
	{ label: "everything", icon: "layout-grid" },
	{ label: "spaces", icon: "folder" },
	{ label: "serendipity", icon: "sparkles" },
];

export function BottomBar() {
	return (
		<nav className="skybox-bottom" aria-label="Places">
			{PLACES.map((place, position) => (
				<button
					className={`skybox-bottom-item${position === 0 ? " is-current" : ""}`}
					key={place.label}
					aria-disabled="true"
					title="Not wired up yet"
				>
					<Icon name={place.icon} />
					<span>{place.label}</span>
				</button>
			))}
		</nav>
	);
}
