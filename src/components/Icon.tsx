import { useEffect, useRef } from "react";
import { setIcon } from "obsidian";

/** One of Obsidian's own icons, by name. */
export function Icon({ name }: { name: string }) {
	const host = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const element = host.current;
		if (!element) return;
		element.empty();
		setIcon(element, name);
	}, [name]);

	return <span className="skybox-icon" ref={host} />;
}
