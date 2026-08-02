import { fileURLToPath } from "node:url";
import type {
	AvatarFaceFixture,
	AvatarFixtureSet,
	AvatarPoseFixture,
	AvatarTorsoFixture,
} from "./fixtures.ts";
import { oracleEmotion } from "./fixtures.ts";

const BOUNDS = [
	[1, 1, 40, 40],
	[42, 1, 136, 127],
	[179, 1, 136, 127],
	[316, 1, 142, 142],
	[459, 1, 136, 127],
	[596, 1, 136, 127],
	[733, 1, 136, 127],
	[870, 1, 136, 126],
	[1, 144, 136, 127],
	[138, 144, 79, 142],
	[218, 144, 108, 143],
	[327, 144, 129, 140],
	[457, 144, 70, 148],
	[528, 144, 97, 153],
	[626, 144, 115, 147],
] as const;

const FACE_SPECS = [
	[2, 9, 0, 77, 126, 77, 50],
	[3, 1, 1, 77, 126, 77, 50],
	[3, 8, 1, 77, 126, 77, 50],
	[4, 2, 1, 83, 140, 83, 65],
	[5, 3, 1, 77, 126, 77, 50],
	[6, 4, 1, 77, 126, 77, 50],
	[7, 5, 1, 77, 126, 77, 50],
	[8, 6, 1, 77, 125, 77, 50],
	[9, 7, 1, 77, 126, 77, 50],
] as const;

// neck anchors measured against each torso's own art, so a raised-arm sheet does not drag the head with it
const TORSO_SPECS = [
	[10, 9, 0, 41, 13],
	[11, 11, 1, 41, 13],
	[13, 12, 1, 42, 16],
	[12, 13, 1, 67, 12],
	[14, 10, 1, 61, 22],
	[15, 14, 1, 58, 16],
] as const;

export const CUSTOM_AVATAR_ATLASES = [
	{
		name: "peety",
		file: "peety-88a95f0415.png",
		source: fileURLToPath(
			new URL(
				"../../public/assets/avatars/peety-88a95f0415.png",
				import.meta.url,
			),
		),
		bounds: BOUNDS,
	},
] as const;

function poses(poseBase: number): AvatarPoseFixture[] {
	return BOUNDS.map(([, , width, height], index) => ({
		poseID: poseBase + index + 1,
		localPoseID: index + 1,
		width,
		height,
	}));
}

function faces(poseBase: number): AvatarFaceFixture[] {
	return FACE_SPECS.map(
		([localPoseID, emotionIndex, intensity, xCX, yCX, faceX, faceY]) => ({
			poseID: poseBase + localPoseID,
			emotion: oracleEmotion(emotionIndex),
			emotionIndex,
			intensity,
			intensityTenths: Math.trunc(intensity * 10),
			xCX,
			yCX,
			deltaXCX: 0,
			deltaYCX: 0,
			faceX,
			faceY,
		}),
	);
}

function torsos(poseBase: number): AvatarTorsoFixture[] {
	return TORSO_SPECS.map(
		([localPoseID, emotionIndex, intensity, xCX, yCX]) => ({
			poseID: poseBase + localPoseID,
			emotion: oracleEmotion(emotionIndex),
			emotionIndex,
			intensity,
			intensityTenths: Math.trunc(intensity * 10),
			xCX,
			yCX,
		}),
	);
}

export function appendCustomAvatars(fixtures: AvatarFixtureSet): void {
	const poseBase = fixtures.poseCount;
	const avatarPoses = poses(poseBase);
	fixtures.castOrder.push("peety");
	fixtures.avatars.push({
		avatarID: fixtures.avatars.length + 1,
		name: "peety",
		type: "complex",
		iconPoseID: poseBase + 1,
		flags: 5,
		poses: avatarPoses,
		faces: faces(poseBase),
		torsos: torsos(poseBase),
		bodies: [],
	});
	fixtures.poseCount += avatarPoses.length;
}
