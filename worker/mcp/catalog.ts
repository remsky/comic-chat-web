export interface CatalogAvatar {
	name: string;
	emotions: Record<string, number>;
	aliases?: Record<string, string>;
	gestures?: string[];
}

export interface Catalog {
	version: number;
	emotions: string[];
	gestures: string[];
	modes: string[];
	cameras: string[];
	facings: string[];
	sizes: string[];
	kinds: string[];
	backgrounds: string[];
	limits: {
		actors: number;
		balloons: number;
		zoom: [number, number];
		columns: [number, number];
	};
	avatars: CatalogAvatar[];
}

let cached: Catalog | undefined;

export async function loadCatalog(assets: Fetcher): Promise<Catalog> {
	if (cached) return cached;
	const response = await assets.fetch(
		new Request("https://placeholder/assets/catalog.json"),
	);
	cached = (await response.json()) as Catalog;
	return cached;
}
