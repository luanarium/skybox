/**
 * The plugin's own vault writes are flagged while they run, so share intake
 * reacts to what the user shared and not to what the plugin saved.
 */
let depth = 0;

export function isWriting(): boolean {
	return depth > 0;
}

export async function guarded<T>(write: () => Promise<T>): Promise<T> {
	depth++;
	try {
		return await write();
	} finally {
		depth--;
	}
}
