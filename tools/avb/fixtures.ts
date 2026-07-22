// Builds compact runtime fixtures from AVB files using the v1 oracle's global pose table.

import { decodePose } from "./convert.ts";
import {
	type AvbParseResult,
	type BodyRecord,
	type FaceRecord,
	parseAvb,
	type TorsoRecord,
} from "./parser.ts";

// Golden-trace cast; order is positional (avatarID + global pose base) and must not change.
export const TRACE_CAST = [
	"anna",
	"bolo",
	"connor",
	"denise",
	"hugh",
	"susan",
] as const;

// Full runtime roster; TRACE_CAST stays first so traced characters keep identical IDs/pose bases.
export const FULL_CAST = [
	...TRACE_CAST,
	"armando",
	"cro",
	"dan",
	"glenda",
	"jordan",
	"lance",
	"lynnea",
	"margaret",
	"mike",
	"pedagog",
	"rainbow",
	"tiki",
	"tongtyed",
	"tux",
	"waf",
	"xeno",
	"buck",
	"kirby",
	"veronica",
	"kevin",
	"kwensa",
	"maynard",
	"rebecca",
	"sage",
	"scotty",
] as const;

export type TraceAvatarName = (typeof TRACE_CAST)[number];
export type AvatarName = (typeof FULL_CAST)[number];

// biome-ignore lint/suspicious/noApproximativeNumericConstant: vector2d.h defines PI as 3.14159; fixture floats must match the oracle
const ORACLE_PI = 3.14159;

const ORACLE_EMOTIONS = [
	0,
	0,
	Math.fround((1 * 2 * ORACLE_PI) / 8),
	Math.fround((2 * 2 * ORACLE_PI) / 8),
	Math.fround((3 * 2 * ORACLE_PI) / 8),
	Math.fround((4 * 2 * ORACLE_PI) / 8),
	Math.fround((5 * 2 * ORACLE_PI) / 8),
	Math.fround((6 * 2 * ORACLE_PI) / 8),
	Math.fround((7 * 2 * ORACLE_PI) / 8),
	0,
	1001,
	1002,
	1003,
	1004,
	1005,
	1006,
	1007,
	1008,
] as const;

export function oracleEmotion(index: number): number {
	return ORACLE_EMOTIONS[index] ?? 0;
}

export interface AvatarPoseFixture {
	poseID: number;
	localPoseID: number;
	width: number;
	height: number;
	sprite?: {
		atlasUrl: string;
		x: number;
		y: number;
	};
}

export interface AvatarFaceFixture {
	poseID: number;
	emotion: number;
	emotionIndex: number;
	intensity: number;
	intensityTenths: number;
	xCX: number;
	yCX: number;
	deltaXCX: number;
	deltaYCX: number;
	faceX: number;
	faceY: number;
}

export interface AvatarTorsoFixture {
	poseID: number;
	emotion: number;
	emotionIndex: number;
	intensity: number;
	intensityTenths: number;
	xCX: number;
	yCX: number;
}

export interface AvatarBodyFixture {
	poseID: number;
	emotion: number;
	emotionIndex: number;
	intensity: number;
	intensityTenths: number;
	faceX: number;
	faceY: number;
}

export interface AvatarFixture {
	avatarID: number;
	name: AvatarName;
	type: "simple" | "complex";
	iconPoseID: number;
	flags: number;
	poses: AvatarPoseFixture[];
	faces: AvatarFaceFixture[];
	torsos: AvatarTorsoFixture[];
	bodies: AvatarBodyFixture[];
}

export interface AvatarFixtureSet {
	castOrder: AvatarName[];
	avatars: AvatarFixture[];
	poseCount: number;
}

export interface AvatarFixtureInput {
	name: AvatarName;
	bytes: Uint8Array;
}

export function formatAvatarFixtureSet(fixtures: AvatarFixtureSet): string {
	const expandedCast = `\t"castOrder": [\n${fixtures.castOrder
		.map(
			(name, index) =>
				`\t\t"${name}"${index === fixtures.castOrder.length - 1 ? "" : ","}`,
		)
		.join("\n")}\n\t]`;
	const compactCast = `\t"castOrder": [${fixtures.castOrder
		.map((name) => `"${name}"`)
		.join(", ")}]`;
	const json = JSON.stringify(fixtures, null, "\t");
	// Match Biome: inline the array only when it fits the 80-col line (tab counts as width 2).
	const body =
		compactCast.replace("\t", "  ").length <= 80
			? json.replace(expandedCast, compactCast)
			: json;
	return `${body}\n`;
}

function globalPoseID(localPoseID: number, poseBase: number): number {
	return localPoseID === 0 ? 0 : poseBase + localPoseID;
}

// Wire intensity is (BYTE)(m_intensity * 10) truncation (avatario.cpp:78).
function intensityTenths(intensityByte: number): number {
	return Math.trunc(Math.fround(intensityByte / 255) * 10);
}

function faceFixture(rec: FaceRecord, poseBase: number): AvatarFaceFixture {
	return {
		poseID: globalPoseID(rec.poseID, poseBase),
		emotion: oracleEmotion(rec.emotion.index),
		emotionIndex: rec.emotion.index,
		intensity: Math.fround(rec.intensityByte / 255),
		intensityTenths: intensityTenths(rec.intensityByte),
		xCX: rec.cx,
		yCX: rec.cy,
		deltaXCX: rec.cxDelta,
		deltaYCX: rec.cyDelta,
		faceX: rec.faceX,
		faceY: rec.faceY,
	};
}

function torsoFixture(rec: TorsoRecord, poseBase: number): AvatarTorsoFixture {
	return {
		poseID: globalPoseID(rec.poseID, poseBase),
		emotion: oracleEmotion(rec.emotion.index),
		emotionIndex: rec.emotion.index,
		intensity: Math.fround(rec.intensityByte / 255),
		intensityTenths: intensityTenths(rec.intensityByte),
		xCX: rec.cx,
		yCX: rec.cy,
	};
}

function bodyFixture(rec: BodyRecord, poseBase: number): AvatarBodyFixture {
	return {
		poseID: globalPoseID(rec.poseID, poseBase),
		emotion: oracleEmotion(rec.emotion.index),
		emotionIndex: rec.emotion.index,
		intensity: Math.fround(rec.intensityByte / 255),
		intensityTenths: intensityTenths(rec.intensityByte),
		faceX: rec.faceX,
		faceY: rec.faceY,
	};
}

function buildAvatar(
	input: AvatarFixtureInput,
	avatarID: number,
	poseBase: number,
): { fixture: AvatarFixture; parsed: AvbParseResult } {
	const parsed = parseAvb(input.bytes);
	const poses = parsed.poses.map((pose) => {
		const decoded = decodePose(input.bytes, pose, parsed.globalPalette);
		if (!decoded.image) {
			throw new Error(
				`${input.name} pose ${pose.poseID}: ${decoded.imageError ?? "missing image"}`,
			);
		}
		return {
			poseID: globalPoseID(pose.poseID, poseBase),
			localPoseID: pose.poseID,
			width: decoded.image.width,
			height: decoded.image.height,
		};
	});

	return {
		parsed,
		fixture: {
			avatarID,
			name: input.name,
			type: parsed.typeName as "simple" | "complex",
			iconPoseID: globalPoseID(parsed.iconPoseID, poseBase),
			flags: parsed.flags,
			poses,
			faces: parsed.faces.map((rec) => faceFixture(rec, poseBase)),
			torsos: parsed.torsos.map((rec) => torsoFixture(rec, poseBase)),
			bodies: parsed.bodies.map((rec) => bodyFixture(rec, poseBase)),
		},
	};
}

export function buildAvatarFixtures(
	inputs: readonly AvatarFixtureInput[],
): AvatarFixtureSet {
	let poseBase = 0;
	const avatars: AvatarFixture[] = [];
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		if (!input) continue;
		const { fixture, parsed } = buildAvatar(input, i + 1, poseBase);
		avatars.push(fixture);
		poseBase += parsed.poses.length;
	}
	return {
		castOrder: inputs.map((input) => input.name),
		avatars,
		poseCount: poseBase,
	};
}
