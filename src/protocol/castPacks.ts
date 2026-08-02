// The art packs the cast and the backdrops came from, and which of them a deploy ships.

export interface ArtPack {
	id: string;
	chip: { label: string; tone: string };
	characters: readonly string[];
	backdrops: readonly string[];
}

// anything these do not claim came with the base v1.0 art and always ships
export const ART_PACKS: readonly ArtPack[] = [
	{
		id: "v2.1b",
		chip: { label: "v2.1b", tone: "v2" },
		characters: ["buck", "kirby", "veronica"],
		backdrops: ["buckroom"],
	},
	{
		id: "artpack1",
		chip: { label: "ART1", tone: "art1" },
		characters: ["kevin", "kwensa", "maynard", "rebecca", "sage", "scotty"],
		backdrops: ["den", "volcano"],
	},
	{
		id: "rem1",
		chip: { label: "REM1", tone: "rem" },
		characters: ["peety"],
		backdrops: ["mauve", "teal", "slate"],
	},
];

export const PACK_IDS: readonly string[] = ART_PACKS.map((pack) => pack.id);

// the skill's vendored reference tracks this repo's own deploy, so the generator and its test read one value
export const VENDORED_PACKS = "artpack1,rem1";

function requested(value: string | undefined): string[] {
	const raw = (value ?? "").trim();
	if (raw === "" || raw === "none") return [];
	if (raw === "all") return [...PACK_IDS];
	return raw
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id !== "");
}

export function resolvePacks(value: string | undefined): ReadonlySet<string> {
	return new Set(requested(value).filter((id) => PACK_IDS.includes(id)));
}

export function unknownPacks(value: string | undefined): string[] {
	return requested(value).filter((id) => !PACK_IDS.includes(id));
}

export function packOf(character: string): ArtPack | undefined {
	return ART_PACKS.find((pack) => pack.characters.includes(character));
}

export function shipsCharacter(
	name: string,
	packs: ReadonlySet<string>,
): boolean {
	const pack = packOf(name);
	return pack === undefined || packs.has(pack.id);
}

export function shipsBackdrop(
	name: string,
	packs: ReadonlySet<string>,
): boolean {
	const pack = ART_PACKS.find((entry) => entry.backdrops.includes(name));
	return pack === undefined || packs.has(pack.id);
}
