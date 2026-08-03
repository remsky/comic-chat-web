// The catalog as it ships to script authors: what each character can express, counted, with no wheel maths in it.

import type { AvatarData } from "../engine/avatar.js";
import { shipsBackdrop, shipsCharacter } from "../protocol/castPacks.js";
import type { CastProse, CastRegister } from "./castProse.js";
import { parseCastProse } from "./castProse.js";
import {
	buildCatalog,
	COLUMNS_MAX,
	COLUMNS_MIN,
	MAX_ACTORS,
	MAX_BALLOONS,
	STRIP_KINDS,
	STRIP_VERSION,
	type StripCatalog,
	ZOOM_MAX,
	ZOOM_MIN,
} from "./script.js";

export const CATALOG_FILE = "assets/catalog.json";

// the skill's reference docs are the single source; the build republishes them so MCP clients read the same text
export const SKILL_REFERENCE =
	"plugins/comic-strip/skills/comic-strip/reference";
export const SKILL_DOCS = ["guidance.md", "backgrounds.md"] as const;
export const SKILL_THUMBS = [
	"thumbs/cast.png",
	"thumbs/backgrounds.png",
] as const;

export const docAsset = (name: string): string => `assets/${name}`;

export interface PublishedAvatar {
	name: string;
	// cast.md's table prose, baked in at generate time
	look?: string;
	range?: string;
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
	kinds: readonly string[];
	backgrounds: readonly string[];
	limits: {
		actors: number;
		balloons: number;
		zoom: [number, number];
		columns: [number, number];
	};
	avatars: PublishedAvatar[];
	// cast.md's casting-by-register bullets, baked in at generate time
	registers: CastRegister[];
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

// the manifest owns the atlas filenames, so pack filtering reads them there rather than rebuilding them from the character name
export function droppedAvatarAtlases(
	avatarJson: string,
	packs: ReadonlySet<string>,
): string[] {
	const { avatars } = JSON.parse(avatarJson) as { avatars: AvatarData[] };
	const kept = new Set<string>();
	const cut = new Set<string>();
	for (const avatar of avatars) {
		const into = shipsCharacter(avatar.name, packs) ? kept : cut;
		for (const pose of avatar.poses)
			if (pose.sprite) into.add(pose.sprite.atlasUrl.split("/").pop() ?? "");
	}
	return [...cut].filter((file) => file !== "" && !kept.has(file));
}

export function shippedManifests(
	avatarJson: string,
	backgroundJson: string,
	packs: ReadonlySet<string>,
): { avatars: string; backgrounds: string } {
	const manifest = JSON.parse(avatarJson) as {
		castOrder: string[];
		avatars: AvatarData[];
	};
	const { backdrops } = JSON.parse(backgroundJson) as {
		backdrops: { name: string }[];
	};
	const avatars = manifest.avatars.filter((entry) =>
		shipsCharacter(entry.name, packs),
	);
	return {
		avatars: JSON.stringify({
			castOrder: manifest.castOrder.filter((name) =>
				shipsCharacter(name, packs),
			),
			avatars,
			poseCount: avatars.reduce(
				(total, entry) => total + entry.poses.length,
				0,
			),
		}),
		backgrounds: JSON.stringify({
			backdrops: backdrops.filter((entry) => shipsBackdrop(entry.name, packs)),
		}),
	};
}

// the committed manifests are the same ones the studio fetches, so the build ships what the page probes
export function catalogFromManifests(
	avatarJson: string,
	backgroundJson: string,
	castMarkdown: string,
): PublishedCatalog {
	const { avatars } = JSON.parse(avatarJson) as { avatars: AvatarData[] };
	const { backdrops } = JSON.parse(backgroundJson) as {
		backdrops: { name: string }[];
	};
	const catalog = buildCatalog(
		avatars,
		backdrops.map((entry) => entry.name),
	);
	const prose = parseCastProse(
		castMarkdown,
		new Set(catalog.avatars.map((entry) => entry.name)),
	);
	return catalogJson(catalog, digest(avatarJson), prose);
}

export function catalogJson(
	catalog: StripCatalog,
	art: string,
	prose: CastProse,
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
		kinds: STRIP_KINDS,
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
				...(prose.notes[entry.name] ?? {}),
				emotions,
				...(Object.keys(aliases).length > 0 ? { aliases } : {}),
				...(entry.gestures.length > 0 ? { gestures: entry.gestures } : {}),
			};
		}),
		registers: prose.registers,
	};
}
