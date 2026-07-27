// The catalog as it ships to script authors: what each character can express, counted, with no wheel maths in it.

import type { AvatarData } from "../engine/avatar.js";
import {
	buildCatalog,
	COLUMNS_MAX,
	COLUMNS_MIN,
	MAX_ACTORS,
	MAX_BALLOONS,
	STRIP_VERSION,
	type StripCatalog,
	ZOOM_MAX,
	ZOOM_MIN,
} from "./script.js";

export const CATALOG_FILE = "assets/catalog.json";

export interface PublishedAvatar {
	name: string;
	// emotion -> how many faces it names: "happy_1" to "happy_N", or bare "happy" for the strongest
	emotions: Record<string, number>;
	aliases?: Record<string, string>;
	// every torso: gesture commands plus "<emotion>_<n>"
	gestures?: string[];
}

export interface PublishedCatalog {
	version: number;
	// digest of the art manifest; degree numbering moves if the avatars are regenerated
	art: string;
	emotions: readonly string[];
	gestures: readonly string[];
	modes: readonly string[];
	cameras: readonly string[];
	facings: readonly string[];
	sizes: readonly string[];
	backgrounds: readonly string[];
	limits: {
		actors: number;
		balloons: number;
		zoom: [number, number];
		columns: [number, number];
	};
	avatars: PublishedAvatar[];
}

// FNV-1a over the manifest text: a staleness marker for regenerated art, not a security digest
function digest(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// the committed manifests are the same ones the studio fetches, so the build ships what the page probes
export function catalogFromManifests(
	avatarJson: string,
	backgroundJson: string,
): PublishedCatalog {
	const { avatars } = JSON.parse(avatarJson) as { avatars: AvatarData[] };
	const { backdrops } = JSON.parse(backgroundJson) as {
		backdrops: { name: string }[];
	};
	return catalogJson(
		buildCatalog(
			avatars,
			backdrops.map((entry) => entry.name),
		),
		digest(avatarJson),
	);
}

export function catalogJson(
	catalog: StripCatalog,
	art: string,
): PublishedCatalog {
	return {
		version: STRIP_VERSION,
		art,
		emotions: catalog.emotions,
		gestures: catalog.gestures,
		modes: catalog.modes,
		cameras: catalog.cameras,
		facings: catalog.facings,
		sizes: catalog.sizes,
		backgrounds: catalog.backgrounds,
		limits: {
			actors: MAX_ACTORS,
			balloons: MAX_BALLOONS,
			zoom: [ZOOM_MIN, ZOOM_MAX],
			columns: [COLUMNS_MIN, COLUMNS_MAX],
		},
		avatars: catalog.avatars.map((entry) => {
			const { counts: emotions, aliases } = entry.art;
			return {
				name: entry.name,
				emotions,
				...(Object.keys(aliases).length > 0 ? { aliases } : {}),
				...(entry.gestures.length > 0 ? { gestures: entry.gestures } : {}),
			};
		}),
	};
}
