// Declared divergences from the shipped AVB art. assets.test.ts pins every other value to the source, so this list is the only place the runtime roster is allowed to disagree with Microsoft's data. Add a line per discrepancy; a repair that changes nothing fails the guard.

import type { AvatarFixtureSet, AvatarName } from "./fixtures.ts";

// faces carry all six; torsos carry xCX and yCX
export type AnchorField =
	| "xCX"
	| "yCX"
	| "deltaXCX"
	| "deltaYCX"
	| "faceX"
	| "faceY";

export interface ArtRepair {
	avatar: AvatarName;
	record: "face" | "torso";
	// every record drawing this pose is repaired, since the anchor belongs to the drawing
	poseID: number;
	field: AnchorField;
	value: number;
	why: string;
}

export const ART_REPAIRS: readonly ArtRepair[] = [
	{
		avatar: "dan",
		record: "face",
		poseID: 176,
		field: "yCX",
		value: 95,
		why: "ships 57 where its eight identically framed siblings carry 93-101, sinking the head into the collar",
	},
];

type AnchorRecord = Partial<Record<AnchorField, number>> & { poseID: number };

// the one cast: a torso carries a subset of the face's anchor fields, so reads and writes are checked at runtime
export function repairTargets(
	fixtures: AvatarFixtureSet,
	repair: ArtRepair,
): AnchorRecord[] {
	const avatar = fixtures.avatars.find((entry) => entry.name === repair.avatar);
	if (!avatar) return [];
	const records: AnchorRecord[] =
		repair.record === "face" ? avatar.faces : avatar.torsos;
	return records.filter((record) => record.poseID === repair.poseID);
}

// how many records each repair touched, positionally; the generator and the guard both reject a zero
export function applyArtRepairs(fixtures: AvatarFixtureSet): number[] {
	return ART_REPAIRS.map((repair) => {
		const targets = repairTargets(fixtures, repair);
		for (const record of targets) {
			if (record[repair.field] === undefined)
				throw new Error(
					`${repair.avatar} ${repair.record} ${repair.poseID} has no ${repair.field}`,
				);
			record[repair.field] = repair.value;
		}
		return targets.length;
	});
}

export function describeRepair(repair: ArtRepair): string {
	return `${repair.avatar} ${repair.record} pose ${repair.poseID} ${repair.field} -> ${repair.value}`;
}
