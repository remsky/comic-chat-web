// Loads the backdrop manifest and images; missing assets degrade to plain white panels.

import { artUrl } from "./artUrl.js";

export interface BackdropInfo {
	name: string;
	url: string;
	width: number;
	height: number;
	copyright: string | null;
}

export class BackdropCache {
	private readonly images = new Map<string, HTMLImageElement>();
	readonly backdrops: BackdropInfo[] = [];

	async load(): Promise<void> {
		let entries: BackdropInfo[];
		try {
			const response = await fetch(artUrl("/assets/backgrounds/manifest.json"));
			if (!response.ok) return;
			entries = ((await response.json()) as { backdrops: BackdropInfo[] })
				.backdrops;
		} catch {
			return;
		}
		this.backdrops.push(...entries);
		await Promise.all(
			entries.map(
				(info) =>
					new Promise<void>((resolve) => {
						const image = new Image();
						image.onload = () => {
							this.images.set(info.name, image);
							resolve();
						};
						image.onerror = () => resolve();
						image.src = info.url;
					}),
			),
		);
	}

	get(name: string): HTMLImageElement | undefined {
		return this.images.get(name);
	}
}
