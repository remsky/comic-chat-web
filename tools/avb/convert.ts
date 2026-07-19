// Decodes parsed poses into RGBA sprites and assembles converter metadata. Pure.

import { inflateSync } from "node:zlib";
import { ByteReader } from "./bytes.ts";
import {
	type Dib,
	type DibHeader,
	decodeBmp,
	dibFromBits,
	numDibColorEntries,
	type Rgb,
} from "./dib.ts";
import {
	AIF_DIB,
	AIF_LZDEFLATE,
	AIP_GLOBALPALETTE,
	AIP_LOCALPALETTE,
	AIP_MASKEDMONO,
	AIP_MONOCHROME,
	AK,
	type AvbParseResult,
	type PoseRef,
	parseAvb,
} from "./parser.ts";
import { encodePng } from "./png.ts";

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const MONO_PALETTE: Rgb[] = [
	{ r: 255, g: 255, b: 255 },
	{ r: 0, g: 0, b: 0 },
];
const MASKED_MONO_PALETTE: Rgb[] = [
	{ r: 255, g: 255, b: 255 },
	{ r: 0, g: 0, b: 0 },
	{ r: 128, g: 0, b: 0 },
	{ r: 0, g: 0, b: 128 },
];

export interface DecodedPose {
	poseID: number;
	image: Dib | null;
	mask: Dib | null;
	aura: Dib | null;
	imageError: string | null;
}

// Color table for a zlib image by palette type (CAvatarFileImage::GetProperPalette).
function paletteForType(
	r: ByteReader,
	paletteType: number,
	globalPalette: Rgb[] | null,
	sizedTags: boolean,
): Rgb[] {
	if (paletteType === AIP_GLOBALPALETTE) {
		return globalPalette ?? [];
	}
	if (paletteType === AIP_MONOCHROME) {
		return MONO_PALETTE;
	}
	if (paletteType === AIP_MASKEDMONO) {
		return MASKED_MONO_PALETTE;
	}
	if (paletteType === AIP_LOCALPALETTE) {
		const tag = r.u16();
		if (tag !== AK.COLORPALETTE) {
			throw new Error(`expected inline palette tag, got ${tag}`);
		}
		if (sizedTags) r.u16();
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
	return [];
}

function decodeZlibImage(
	buf: Uint8Array,
	offset: number,
	paletteType: number,
	globalPalette: Rgb[] | null,
	sizedTags: boolean,
): Dib {
	const r = new ByteReader(buf);
	r.seek(offset);
	const palette = paletteForType(r, paletteType, globalPalette, sizedTags);
	const headerSize = r.u32();
	const width = r.i32();
	const height = r.i32();
	r.u16();
	const bitCount = r.u16();
	const compression = r.u32();
	const sizeImage = r.u32();
	r.i32();
	r.i32();
	const clrUsed = r.u32();
	r.u32();
	if (headerSize > 40) {
		r.skip(headerSize - 40);
	}
	const uncompressedSize = r.u32();
	const compressedSize = r.u32();
	const compressed = r.bytes(compressedSize);
	const raw = inflateSync(compressed);
	const bits = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	if (bits.length !== uncompressedSize) {
		throw new Error(`zlib size mismatch ${bits.length} != ${uncompressedSize}`);
	}
	const header: DibHeader = {
		bfOffBits: 0,
		bfSize: 0,
		width,
		height: Math.abs(height),
		bitCount,
		compression,
		sizeImage,
		clrUsed,
		topDown: height < 0,
		colorCount: numDibColorEntries(bitCount, clrUsed),
	};
	return dibFromBits(header, bits, palette);
}

function decodeImage(
	buf: Uint8Array,
	offset: number,
	format: number,
	paletteType: number,
	globalPalette: Rgb[] | null,
	sizedTags: boolean,
): Dib {
	if (offset === 0) {
		throw new Error("null offset");
	}
	if (format === AIF_DIB) {
		return decodeBmp(buf, offset);
	}
	if (format === AIF_LZDEFLATE) {
		return decodeZlibImage(buf, offset, paletteType, globalPalette, sizedTags);
	}
	throw new Error(`unsupported image format ${format}`);
}

function decodeOptional(
	buf: Uint8Array,
	offset: number,
	format: number,
	paletteType: number,
	globalPalette: Rgb[] | null,
	sizedTags: boolean,
): Dib | null {
	if (offset === 0) {
		return null;
	}
	return decodeImage(
		buf,
		offset,
		format,
		paletteType,
		globalPalette,
		sizedTags,
	);
}

// sizedTags: new-magic (0x8181) files frame inline data-section tags with a u16 byte size
export function decodePose(
	buf: Uint8Array,
	pose: PoseRef,
	globalPalette: Rgb[] | null,
	sizedTags = false,
): DecodedPose {
	let image: Dib | null = null;
	let imageError: string | null = null;
	try {
		image =
			pose.imageOffset === 0
				? null
				: decodeImage(
						buf,
						pose.imageOffset,
						pose.imageFormat,
						pose.imagePaletteType,
						globalPalette,
						sizedTags,
					);
	} catch (err) {
		imageError = err instanceof Error ? err.message : String(err);
	}
	const mask = decodeOptional(
		buf,
		pose.maskOffset,
		pose.maskFormat,
		pose.maskPaletteType,
		globalPalette,
		sizedTags,
	);
	const aura = decodeOptional(
		buf,
		pose.auraOffset,
		pose.auraFormat,
		pose.auraPaletteType,
		globalPalette,
		sizedTags,
	);
	return { poseID: pose.poseID, image, mask, aura, imageError };
}

function pixelRgb(dib: Dib, x: number, y: number): Rgb {
	const idx = dib.indices[y * dib.width + x] as number;
	return dib.palette[idx] ?? WHITE;
}

function isDark(c: Rgb): boolean {
	return (c.r + c.g + c.b) / 3 < 128;
}

// The original StretchBlts helper DIBs to the drawing rect, so sample with a nearest-neighbor stretch
function darkAtStretched(
	dib: Dib,
	x: number,
	y: number,
	width: number,
	height: number,
): boolean {
	const sx = Math.min(dib.width - 1, Math.trunc((x * dib.width) / width));
	const sy = Math.min(dib.height - 1, Math.trunc((y * dib.height) / height));
	return isDark(pixelRgb(dib, sx, sy));
}

// Composites a drawing into RGBA mirroring DrawBody's MERGEPAINT aura/mask white-out followed by the SRCAND drawing: the silhouette region (and any stray ink) is opaque, interior whites included, so backdrops do not show through bodies (bodycam.cpp:443-480).
export function composeImageRgba(
	image: Dib,
	mask: Dib | null,
	aura: Dib | null = null,
): Uint8Array {
	const { width, height } = image;
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const c = pixelRgb(image, x, y);
			const p = (y * width + x) * 4;
			out[p] = c.r;
			out[p + 1] = c.g;
			out[p + 2] = c.b;
			const ink = !(c.r === 255 && c.g === 255 && c.b === 255);
			const whited =
				(aura !== null && darkAtStretched(aura, x, y, width, height)) ||
				(mask !== null && darkAtStretched(mask, x, y, width, height));
			out[p + 3] = whited || ink ? 255 : 0;
		}
	}
	return out;
}

// Renders a monochrome helper DIB (mask or aura) as opaque RGBA for archival.
export function monoRgba(dib: Dib): Uint8Array {
	const { width, height } = dib;
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const c = pixelRgb(dib, x, y);
			const p = (y * width + x) * 4;
			out[p] = c.r;
			out[p + 1] = c.g;
			out[p + 2] = c.b;
			out[p + 3] = 255;
		}
	}
	return out;
}

export interface PngOutput {
	file: string;
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface ConvertResult {
	parsed: AvbParseResult;
	metadata: Record<string, unknown>;
	pngs: PngOutput[];
}

function dibSummary(dib: Dib): Record<string, unknown> {
	return {
		width: dib.width,
		height: dib.height,
		bitCount: dib.bitCount,
		paletteEntries: dib.palette.length,
	};
}

export function convert(buf: Uint8Array, baseName: string): ConvertResult {
	const parsed = parseAvb(buf);
	const pngs: PngOutput[] = [];
	const poseMeta: Record<string, unknown>[] = [];

	for (const pose of parsed.poses) {
		const decoded = decodePose(buf, pose, parsed.globalPalette);
		const entry: Record<string, unknown> = {
			poseID: pose.poseID,
			offsets: {
				image: pose.imageOffset,
				mask: pose.maskOffset,
				aura: pose.auraOffset,
			},
			formats: {
				image: pose.imageFormat,
				mask: pose.maskFormat,
				aura: pose.auraFormat,
			},
			paletteTypes: {
				image: pose.imagePaletteType,
				mask: pose.maskPaletteType,
				aura: pose.auraPaletteType,
			},
			image: null,
			mask: null,
			aura: null,
		};

		if (decoded.image) {
			const rgba = composeImageRgba(decoded.image, decoded.mask, decoded.aura);
			const file = `${baseName}_pose${pose.poseID}.png`;
			pngs.push({
				file,
				bytes: encodePng(decoded.image.width, decoded.image.height, rgba),
				width: decoded.image.width,
				height: decoded.image.height,
			});
			entry.image = {
				file,
				...dibSummary(decoded.image),
				alphaSource: decoded.aura
					? "auraWhiteOut"
					: decoded.mask
						? "mask"
						: "whiteKey",
			};
		} else if (decoded.imageError) {
			entry.imageError = decoded.imageError;
		}

		if (decoded.mask) {
			const file = `${baseName}_pose${pose.poseID}_mask.png`;
			pngs.push({
				file,
				bytes: encodePng(
					decoded.mask.width,
					decoded.mask.height,
					monoRgba(decoded.mask),
				),
				width: decoded.mask.width,
				height: decoded.mask.height,
			});
			entry.mask = { file, ...dibSummary(decoded.mask) };
		}

		if (decoded.aura) {
			const file = `${baseName}_pose${pose.poseID}_aura.png`;
			pngs.push({
				file,
				bytes: encodePng(
					decoded.aura.width,
					decoded.aura.height,
					monoRgba(decoded.aura),
				),
				width: decoded.aura.width,
				height: decoded.aura.height,
			});
			entry.aura = { file, ...dibSummary(decoded.aura) };
		}

		poseMeta.push(entry);
	}

	const metadata: Record<string, unknown> = {
		source: `${baseName}.avb`,
		format: {
			magicNum: parsed.magicNum,
			isOldFormat: parsed.magicNum === 0x81,
			type: parsed.type,
			typeName: parsed.typeName,
			version: parsed.version,
		},
		name: parsed.name,
		style: parsed.style,
		flags: parsed.flags,
		flagsDecoded: {
			headMask: (parsed.flags & 1) !== 0,
			torsoMask: (parsed.flags & 2) !== 0,
			torsoFirst: (parsed.flags & 4) !== 0,
			otherMapped: (parsed.flags & 8) !== 0,
		},
		iconPoseID: parsed.iconPoseID,
		copyright: parsed.copyright,
		originalUrl: parsed.originalUrl,
		overrideUrl: parsed.overrideUrl,
		usageFlags: parsed.usageFlags,
		transparentColor: WHITE,
		globalPalette: parsed.globalPalette,
		poseCount: parsed.poses.length,
		poses: poseMeta,
		faces: parsed.faces,
		torsos: parsed.torsos,
		bodies: parsed.bodies,
		bytesConsumed: parsed.bytesConsumed,
		fileSize: buf.length,
	};

	return { parsed, metadata, pngs };
}
