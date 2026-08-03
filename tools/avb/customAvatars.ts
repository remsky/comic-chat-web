// Drop-in avatars: one json in customAvatars/ plus its atlas png beside the cast art, no code per character.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	AvatarFaceFixture,
	AvatarFixtureSet,
	AvatarPoseFixture,
	AvatarTorsoFixture,
} from "./fixtures.ts";
import { oracleEmotion } from "./fixtures.ts";

interface CustomPose {
	localPoseID: number;
	name: string;
	bounds: [number, number, number, number];
}

interface CustomFace {
	localPoseID: number;
	emotionIndex: number;
	intensity: number;
	anchor: [number, number];
	face: [number, number];
}

interface CustomTorso {
	localPoseID: number;
	emotionIndex: number;
	intensity: number;
	anchor: [number, number];
}

interface CustomAvatarSpec {
	name: string;
	type: "simple" | "complex";
	flags: number;
	atlas: string;
	iconLocalPoseID: number;
	poses: CustomPose[];
	faces: CustomFace[];
	torsos: CustomTorso[];
}

const SPEC_DIR = new URL("customAvatars/", import.meta.url);
const ATLAS_DIR = new URL("../../public/assets/avatars/", import.meta.url);

function loadSpec(file: string): CustomAvatarSpec {
	const spec = JSON.parse(
		readFileSync(new URL(file, SPEC_DIR), "utf8"),
	) as CustomAvatarSpec;
	spec.poses.forEach((pose, index) => {
		if (pose.localPoseID !== index + 1)
			throw new Error(
				`${file}: poses must run 1..n in order, found ${pose.localPoseID} at ${index}`,
			);
	});
	for (const part of [...spec.faces, ...spec.torsos])
		if (!spec.poses[part.localPoseID - 1])
			throw new Error(`${file}: no pose ${part.localPoseID}`);
	return spec;
}

const SPECS = readdirSync(SPEC_DIR)
	.filter((file) => file.endsWith(".json"))
	.sort()
	.map(loadSpec);

export const CUSTOM_AVATAR_ATLASES = SPECS.map((spec) => ({
	name: spec.name,
	file: spec.atlas,
	source: fileURLToPath(new URL(spec.atlas, ATLAS_DIR)),
	bounds: spec.poses.map((pose) => pose.bounds),
}));

function poses(spec: CustomAvatarSpec, poseBase: number): AvatarPoseFixture[] {
	return spec.poses.map((pose) => ({
		poseID: poseBase + pose.localPoseID,
		localPoseID: pose.localPoseID,
		width: pose.bounds[2],
		height: pose.bounds[3],
	}));
}

function faces(spec: CustomAvatarSpec, poseBase: number): AvatarFaceFixture[] {
	return spec.faces.map((face) => {
		const intensity = Math.fround(face.intensity);
		return {
			poseID: poseBase + face.localPoseID,
			emotion: oracleEmotion(face.emotionIndex),
			emotionIndex: face.emotionIndex,
			intensity,
			intensityTenths: Math.trunc(intensity * 10),
			xCX: face.anchor[0],
			yCX: face.anchor[1],
			deltaXCX: 0,
			deltaYCX: 0,
			faceX: face.face[0],
			faceY: face.face[1],
		};
	});
}

// neck anchors measured against each torso's own art, so a raised-arm sheet does not drag the head with it
function torsos(
	spec: CustomAvatarSpec,
	poseBase: number,
): AvatarTorsoFixture[] {
	return spec.torsos.map((torso) => {
		const intensity = Math.fround(torso.intensity);
		return {
			poseID: poseBase + torso.localPoseID,
			emotion: oracleEmotion(torso.emotionIndex),
			emotionIndex: torso.emotionIndex,
			intensity,
			intensityTenths: Math.trunc(intensity * 10),
			xCX: torso.anchor[0],
			yCX: torso.anchor[1],
		};
	});
}

export function appendCustomAvatars(fixtures: AvatarFixtureSet): void {
	for (const spec of SPECS) {
		const poseBase = fixtures.poseCount;
		const avatarPoses = poses(spec, poseBase);
		fixtures.castOrder.push(spec.name);
		fixtures.avatars.push({
			avatarID: fixtures.avatars.length + 1,
			name: spec.name,
			type: spec.type,
			iconPoseID: poseBase + spec.iconLocalPoseID,
			flags: spec.flags,
			poses: avatarPoses,
			faces: faces(spec, poseBase),
			torsos: torsos(spec, poseBase),
			bodies: [],
		});
		fixtures.poseCount += avatarPoses.length;
	}
}
