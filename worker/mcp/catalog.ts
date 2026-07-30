// type-only imports, so the worker bundle stays clear of the studio's build modules
import type {
	PublishedAvatar,
	PublishedCatalog,
} from "../../src/studio/catalogJson.js";

export type CatalogAvatar = PublishedAvatar;
export type Catalog = PublishedCatalog;

let cached: Catalog | undefined;

export async function loadCatalog(assets: Fetcher): Promise<Catalog> {
	if (cached) return cached;
	const response = await assets.fetch(
		new Request("https://placeholder/assets/catalog.json"),
	);
	cached = (await response.json()) as Catalog;
	return cached;
}
