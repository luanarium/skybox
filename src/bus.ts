/** A request from outside React to surface a card: share intake, commands. */
export interface OpenRequest {
	path: string;
	/** Expand straight into the editor instead of staying on the grid. */
	expand: boolean;
}

export class Bus {
	private listeners = new Set<(request: OpenRequest) => void>();
	/** Held until the grid is listening, for a cold start from the share sheet. */
	private queued: OpenRequest | null = null;

	emit(request: OpenRequest): void {
		if (this.listeners.size === 0) {
			this.queued = request;
			return;
		}
		for (const listener of this.listeners) listener(request);
	}

	on(listener: (request: OpenRequest) => void): () => void {
		this.listeners.add(listener);
		if (this.queued) {
			const request = this.queued;
			this.queued = null;
			listener(request);
		}
		return () => this.listeners.delete(listener);
	}
}
