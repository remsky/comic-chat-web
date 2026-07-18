// Pure parser for the AVB avatar format (avbfile.cpp LoadAvatar, avatario.cpp).

import { ByteReader } from "./bytes.ts";
import { type Rgb, readPalette } from "./dib.ts";

export const AK = {
	NAME: 1,
	FLAGS: 2,
	ICON: 3,
	NFACES: 4,
	NTORSOS: 5,
	STARTDATA: 6,
	ENDDATA: 7,
	STYLE: 8,
	NBODIES: 9,
	NFACES2: 10,
	NTORSOS2: 11,
	NBODIES2: 12,
	ICON_NEW: 256,
	COLORPALETTE: 257,
	BACKDROP: 258,
	COPYRIGHT: 259,
	ORIGINAL_URL: 260,
	OVERRIDE_URL: 261,
	USAGE_FLAGS: 262,
	OFFSET_ADJUSTMENT: 263,
} as const;

export const AF_MAGICNUM = 0x81;
export const AF_MAGICNUM_NEW = 0x8181;
export const AT_SIMPLE = 1;
export const AT_COMPLEX = 2;
export const AT_BACKDROP = 3;

export const AIF_DIB = 0;
export const AIF_LZDEFLATE = 1;

export const AIP_NOPALETTE = 0;
export const AIP_GLOBALPALETTE = 1;
export const AIP_LOCALPALETTE = 2;
export const AIP_MONOCHROME = 3;
export const AIP_MASKEDMONO = 4;
export const AIP_DUALMASK = 5;

// emFloats table from avatario.cpp / avatar.h. Index 0 is a spare zero slot.
const EMOTIONS: { label: string; radians: number }[] = [
	{ label: "zero", radians: 0 },
	{ label: "happy", radians: 0 },
	{ label: "coy", radians: Math.PI / 4 },
	{ label: "bored", radians: Math.PI / 2 },
	{ label: "scared", radians: (3 * Math.PI) / 4 },
	{ label: "sad", radians: Math.PI },
	{ label: "angry", radians: (5 * Math.PI) / 4 },
	{ label: "shout", radians: (3 * Math.PI) / 2 },
	{ label: "laugh", radians: (7 * Math.PI) / 4 },
	{ label: "neutral", radians: 0 },
	{ label: "wave", radians: 1001 },
	{ label: "pointother", radians: 1002 },
	{ label: "pointself", radians: 1003 },
	{ label: "doublepoint", radians: 1004 },
	{ label: "shrug", radians: 1005 },
	{ label: "3qrwalk", radians: 1006 },
	{ label: "sidewalk", radians: 1007 },
	{ label: "3qfwalk", radians: 1008 },
];

export interface PoseRef {
	poseID: number;
	imageOffset: number;
	maskOffset: number;
	auraOffset: number;
	imageFormat: number;
	maskFormat: number;
	auraFormat: number;
	imagePaletteType: number;
	maskPaletteType: number;
	auraPaletteType: number;
}

export interface EmotionInfo {
	index: number;
	label: string;
	radians: number;
}

export interface FaceRecord {
	poseID: number;
	emotion: EmotionInfo;
	intensityByte: number;
	intensity: number;
	cx: number;
	cy: number;
	cxDelta: number;
	cyDelta: number;
	faceX: number;
	faceY: number;
}

export interface TorsoRecord {
	poseID: number;
	emotion: EmotionInfo;
	intensityByte: number;
	intensity: number;
	cx: number;
	cy: number;
}

export interface BodyRecord {
	poseID: number;
	emotion: EmotionInfo;
	intensityByte: number;
	intensity: number;
	faceX: number;
	faceY: number;
}

export interface AvbParseResult {
	magicNum: number;
	type: number;
	typeName: string;
	version: number;
	name: string | null;
	style: number;
	flags: number;
	iconPoseID: number;
	copyright: string | null;
	originalUrl: string | null;
	overrideUrl: string | null;
	usageFlags: number | null;
	globalPalette: Rgb[] | null;
	poses: PoseRef[];
	faces: FaceRecord[];
	torsos: TorsoRecord[];
	bodies: BodyRecord[];
	bytesConsumed: number;
}

function emotionInfo(index: number): EmotionInfo {
	const e = index >= 0 && index < EMOTIONS.length ? EMOTIONS[index] : undefined;
	return { index, label: e?.label ?? "unknown", radians: e?.radians ?? 0 };
}

interface ParseState {
	poses: PoseRef[];
	adjustment: number;
}

function addPose(state: ParseState, ref: Omit<PoseRef, "poseID">): number {
	const poseID = state.poses.length + 1;
	state.poses.push({ poseID, ...ref });
	return poseID;
}

function adjust(offset: number, by: number): number {
	return offset !== 0 ? offset + by : offset;
}

export function parseAvb(buf: Uint8Array): AvbParseResult {
	const r = new ByteReader(buf);
	const magicNum = r.u16();
	if (magicNum !== AF_MAGICNUM && magicNum !== AF_MAGICNUM_NEW) {
		throw new Error(`not an avatar file (magic 0x${magicNum.toString(16)})`);
	}
	const type = r.u16();
	const version = r.u16();
	if (type !== AT_SIMPLE && type !== AT_COMPLEX) {
		throw new Error(`unsupported avatar type ${type}`);
	}

	const state: ParseState = { poses: [], adjustment: 0 };
	const result: AvbParseResult = {
		magicNum,
		type,
		typeName: type === AT_COMPLEX ? "complex" : "simple",
		version,
		name: null,
		style: 0,
		flags: 0,
		iconPoseID: 0,
		copyright: null,
		originalUrl: null,
		overrideUrl: null,
		usageFlags: null,
		globalPalette: null,
		poses: state.poses,
		faces: [],
		torsos: [],
		bodies: [],
		bytesConsumed: 0,
	};

	while (r.remaining > 0) {
		const tag = r.u16();
		let size = 0;
		if (tag >= AK.ICON_NEW) {
			size = r.u16();
		}
		if (tag === AK.STARTDATA) {
			break;
		}
		handleTag(r, tag, size, state, result);
	}

	result.bytesConsumed = r.pos;
	return result;
}

function handleTag(
	r: ByteReader,
	tag: number,
	size: number,
	state: ParseState,
	result: AvbParseResult,
): void {
	switch (tag) {
		case AK.NAME:
			result.name = r.cString(60);
			break;
		case AK.STYLE:
			result.style = r.u16() & 0xff;
			break;
		case AK.FLAGS:
			result.flags = r.u16() & 0xff;
			break;
		case AK.COPYRIGHT:
			result.copyright = r.cString(256);
			break;
		case AK.ORIGINAL_URL:
			result.originalUrl = r.cString(512);
			break;
		case AK.OVERRIDE_URL:
			result.overrideUrl = r.cString(512);
			break;
		case AK.USAGE_FLAGS:
			result.usageFlags = r.u8();
			break;
		case AK.OFFSET_ADJUSTMENT:
			state.adjustment += r.i32();
			break;
		case AK.COLORPALETTE:
			result.globalPalette = readPaletteRecord(r);
			break;
		case AK.ICON: {
			const off = adjust(r.u32(), state.adjustment);
			result.iconPoseID = addPose(
				state,
				singlePose(off, AIF_DIB, AIP_NOPALETTE),
			);
			break;
		}
		case AK.ICON_NEW: {
			const off = adjust(r.u32(), state.adjustment);
			const format = r.u8();
			const palette = r.u8();
			result.iconPoseID = addPose(state, singlePose(off, format, palette));
			break;
		}
		case AK.NFACES:
		case AK.NFACES2:
			loadFaces(r, tag === AK.NFACES, state, result);
			break;
		case AK.NTORSOS:
		case AK.NTORSOS2:
			loadTorsos(r, tag === AK.NTORSOS, state, result);
			break;
		case AK.NBODIES:
		case AK.NBODIES2:
			loadBodies(r, tag === AK.NBODIES, state, result);
			break;
		default:
			if (tag >= AK.ICON_NEW) {
				r.skip(size);
			} else {
				throw new Error(`unrecognized old tag ${tag} at ${r.pos}`);
			}
			break;
	}
}

function singlePose(
	offset: number,
	format: number,
	palette: number,
): Omit<PoseRef, "poseID"> {
	return {
		imageOffset: offset,
		maskOffset: 0,
		auraOffset: 0,
		imageFormat: format,
		maskFormat: 0,
		auraFormat: 0,
		imagePaletteType: palette,
		maskPaletteType: 0,
		auraPaletteType: 0,
	};
}

function readPaletteRecord(r: ByteReader): Rgb[] {
	const nEntries = r.i16();
	const out: Rgb[] = [];
	for (let i = 0; i < nEntries; i++) {
		const red = r.u8();
		const green = r.u8();
		const blue = r.u8();
		out.push({ r: red, g: green, b: blue });
	}
	return out;
}

interface OffsetTriple {
	imageOffset: number;
	maskOffset: number;
	auraOffset: number;
	imageFormat: number;
	maskFormat: number;
	auraFormat: number;
	imagePaletteType: number;
	maskPaletteType: number;
	auraPaletteType: number;
}

function readOffsets(r: ByteReader, isOld: boolean): OffsetTriple {
	const imageOffset = r.u32();
	const maskOffset = r.u32();
	const auraOffset = r.u32();
	if (isOld) {
		return {
			imageOffset,
			maskOffset,
			auraOffset,
			imageFormat: AIF_DIB,
			maskFormat: AIF_DIB,
			auraFormat: AIF_DIB,
			imagePaletteType: AIP_NOPALETTE,
			maskPaletteType: AIP_NOPALETTE,
			auraPaletteType: AIP_NOPALETTE,
		};
	}
	return {
		imageOffset,
		maskOffset,
		auraOffset,
		imageFormat: 0,
		maskFormat: 0,
		auraFormat: 0,
		imagePaletteType: 0,
		maskPaletteType: 0,
		auraPaletteType: 0,
	};
}

// Resolves the pose for a record honoring the adjacent ditto rule (prev offset 0).
function resolvePose(
	state: ParseState,
	off: OffsetTriple,
	prevImageOffset: number,
	prevPoseID: number,
	adjustment: number,
): number {
	if (off.imageOffset !== prevImageOffset) {
		return addPose(state, {
			imageOffset: adjust(off.imageOffset, adjustment),
			maskOffset: adjust(off.maskOffset, adjustment),
			auraOffset: adjust(off.auraOffset, adjustment),
			imageFormat: off.imageFormat,
			maskFormat: off.maskFormat,
			auraFormat: off.auraFormat,
			imagePaletteType: off.imagePaletteType,
			maskPaletteType: off.maskPaletteType,
			auraPaletteType: off.auraPaletteType,
		});
	}
	return prevPoseID;
}

function readFormatsTail(
	r: ByteReader,
	off: OffsetTriple,
	isOld: boolean,
): void {
	if (isOld) {
		r.skip(16);
		return;
	}
	off.imageFormat = r.u8();
	off.maskFormat = r.u8();
	off.auraFormat = r.u8();
	off.imagePaletteType = r.u8();
	off.maskPaletteType = r.u8();
	off.auraPaletteType = r.u8();
}

function loadFaces(
	r: ByteReader,
	isOld: boolean,
	state: ParseState,
	result: AvbParseResult,
): void {
	const count = r.i16();
	let prevOffset = 0;
	let prevPoseID = 0;
	for (let i = 0; i < count; i++) {
		const off = readOffsets(r, isOld);
		const emotion = r.i16();
		const intensityByte = r.u8();
		const cx = r.i16();
		const cy = r.i16();
		const cxDelta = r.i16();
		const cyDelta = r.i16();
		const x = r.i16();
		const y = r.i16();
		readFormatsTail(r, off, isOld);
		const poseID = resolvePose(
			state,
			off,
			prevOffset,
			prevPoseID,
			state.adjustment,
		);
		prevOffset = off.imageOffset;
		prevPoseID = poseID;
		result.faces.push({
			poseID,
			emotion: emotionInfo(emotion),
			intensityByte,
			intensity: intensityByte / 255,
			cx,
			cy,
			cxDelta,
			cyDelta,
			faceX: x & 0xff,
			faceY: y & 0xff,
		});
	}
}

function loadTorsos(
	r: ByteReader,
	isOld: boolean,
	state: ParseState,
	result: AvbParseResult,
): void {
	const count = r.i16();
	let prevOffset = 0;
	let prevPoseID = 0;
	for (let i = 0; i < count; i++) {
		const off = readOffsets(r, isOld);
		const emotion = r.i16();
		const intensityByte = r.u8();
		const cx = r.i16();
		const cy = r.i16();
		readFormatsTail(r, off, isOld);
		const poseID = resolvePose(
			state,
			off,
			prevOffset,
			prevPoseID,
			state.adjustment,
		);
		prevOffset = off.imageOffset;
		prevPoseID = poseID;
		result.torsos.push({
			poseID,
			emotion: emotionInfo(emotion),
			intensityByte,
			intensity: intensityByte / 255,
			cx,
			cy,
		});
	}
}

function loadBodies(
	r: ByteReader,
	isOld: boolean,
	state: ParseState,
	result: AvbParseResult,
): void {
	const count = r.i16();
	let prevOffset = 0;
	let prevPoseID = 0;
	for (let i = 0; i < count; i++) {
		const off = readOffsets(r, isOld);
		const emotion = r.i16();
		const intensityByte = r.u8();
		const x = r.i16();
		const y = r.i16();
		readFormatsTail(r, off, isOld);
		const poseID = resolvePose(
			state,
			off,
			prevOffset,
			prevPoseID,
			state.adjustment,
		);
		prevOffset = off.imageOffset;
		prevPoseID = poseID;
		result.bodies.push({
			poseID,
			emotion: emotionInfo(emotion),
			intensityByte,
			intensity: intensityByte / 255,
			faceX: x & 0xff,
			faceY: y & 0xff,
		});
	}
}

export { readPalette };
