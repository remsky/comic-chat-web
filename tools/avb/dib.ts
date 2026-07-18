// DIB decoder ported from CDIB (dib.cpp): BI_RGB, BI_RLE4 and BI_RLE8.

import { ByteReader } from "./bytes.ts";

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface Dib {
	width: number;
	height: number;
	bitCount: number;
	compression: number;
	topDown: boolean;
	palette: Rgb[];
	// Indexed pixels, one entry per pixel, laid out top to bottom, width per row.
	indices: Uint8Array;
}

const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;

export function numDibColorEntries(bitCount: number, clrUsed: number): number {
	let colors = 0;
	if (bitCount === 1) colors = 2;
	else if (bitCount === 4) colors = 16;
	else if (bitCount === 8) colors = 256;
	if (colors !== 0 && clrUsed !== 0) {
		colors = clrUsed > colors ? colors : clrUsed;
	}
	return colors;
}

export function storageWidth(width: number, bitCount: number): number {
	return Math.floor((width * bitCount + 31) / 32) * 4;
}

export interface DibHeader {
	bfOffBits: number;
	bfSize: number;
	width: number;
	height: number;
	bitCount: number;
	compression: number;
	sizeImage: number;
	clrUsed: number;
	topDown: boolean;
	colorCount: number;
}

export function readDibHeader(buf: Uint8Array, offset: number): DibHeader {
	const r = new ByteReader(buf);
	r.seek(offset);
	const bfType = r.u16();
	if (bfType !== 0x4d42) {
		throw new Error(
			`not a BMP at offset ${offset} (got 0x${bfType.toString(16)})`,
		);
	}
	const bfSize = r.u32();
	r.skip(4);
	const bfOffBits = r.u32();
	const biSize = r.u32();
	const width = r.i32();
	const rawHeight = r.i32();
	r.u16();
	const bitCount = r.u16();
	const compression = r.u32();
	const sizeImage = r.u32();
	r.i32();
	r.i32();
	const clrUsed = r.u32();
	r.u32();
	const topDown = rawHeight < 0;
	const height = Math.abs(rawHeight);
	if (biSize !== 40) {
		throw new Error(`unsupported BITMAPINFOHEADER size ${biSize} at ${offset}`);
	}
	return {
		bfOffBits,
		bfSize,
		width,
		height,
		bitCount,
		compression,
		sizeImage,
		clrUsed,
		topDown,
		colorCount: numDibColorEntries(bitCount, clrUsed),
	};
}

export function decodeBmp(
	buf: Uint8Array,
	offset: number,
	paletteOverride?: Rgb[],
): Dib {
	const h = readDibHeader(buf, offset);
	const palette =
		paletteOverride ?? readPalette(buf, offset + 14 + 40, h.colorCount);
	const bits = buf.subarray(offset + h.bfOffBits, offset + h.bfSize);
	return dibFromBits(h, bits, palette);
}

export function readPalette(buf: Uint8Array, at: number, count: number): Rgb[] {
	const palette: Rgb[] = [];
	for (let i = 0; i < count; i++) {
		const p = at + i * 4;
		palette.push({
			b: buf[p] as number,
			g: buf[p + 1] as number,
			r: buf[p + 2] as number,
		});
	}
	return palette;
}

// Builds a Dib from raw (possibly RLE) bit data plus a palette (BMP or external).
export function dibFromBits(
	h: DibHeader,
	bits: Uint8Array,
	palette: Rgb[],
): Dib {
	let packed: Uint8Array;
	if (h.compression === BI_RLE4) {
		packed = decodeRle4(bits, h.width, h.height, h.sizeImage);
	} else if (h.compression === BI_RLE8) {
		packed = decodeRle8(bits, h.width, h.height, h.sizeImage);
	} else if (h.compression === BI_RGB) {
		packed = bits;
	} else {
		throw new Error(`unsupported compression ${h.compression}`);
	}
	const indices = unpackIndices(
		packed,
		h.width,
		h.height,
		h.bitCount,
		h.topDown,
	);
	return {
		width: h.width,
		height: h.height,
		bitCount: h.bitCount,
		compression: h.compression,
		topDown: h.topDown,
		palette,
		indices,
	};
}

function unpackIndices(
	packed: Uint8Array,
	width: number,
	height: number,
	bitCount: number,
	topDown: boolean,
): Uint8Array {
	const stride = storageWidth(width, bitCount);
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		const srcRow = topDown ? y : height - 1 - y;
		const base = srcRow * stride;
		const dst = y * width;
		for (let x = 0; x < width; x++) {
			let idx = 0;
			if (bitCount === 8) {
				idx = packed[base + x] as number;
			} else if (bitCount === 4) {
				const b = packed[base + (x >> 1)] as number;
				idx = x & 1 ? b & 0x0f : b >> 4;
			} else if (bitCount === 1) {
				const b = packed[base + (x >> 3)] as number;
				idx = (b >> (7 - (x & 7))) & 1;
			}
			out[dst + x] = idx;
		}
	}
	return out;
}

// RLE4 decoder ported from CDIB::Convert4ToNonRLE (nibble writer mirrors MyWrite).
function decodeRle4(
	bits: Uint8Array,
	width: number,
	height: number,
	sizeImage: number,
): Uint8Array {
	const stride = storageWidth(width, 4);
	const out = new Uint8Array(stride * height);
	const end = sizeImage > 0 ? Math.min(sizeImage, bits.length) : bits.length;
	let bptr = 0;
	let myImg = 0;
	let highRead = true;
	let highWrite = true;

	const write = (advance: boolean): void => {
		let val: number;
		if (highRead) {
			val = (bits[bptr] as number) >> 4;
		} else {
			val = (bits[bptr] as number) & 0x0f;
			if (advance) bptr += 1;
		}
		if (highWrite) {
			out[myImg] = val << 4;
		} else {
			out[myImg] = (out[myImg] as number) | val;
			myImg += 1;
		}
		highRead = !highRead;
		highWrite = !highWrite;
	};

	while (bptr < end) {
		let thisVal = bits[bptr++] as number;
		if (thisVal > 0) {
			while (thisVal-- > 0) {
				write(false);
				if (!(thisVal-- > 0)) break;
				write(false);
			}
			bptr += 1;
			highRead = true;
		} else {
			thisVal = bits[bptr++] as number;
			if (thisVal >= 3) {
				while (thisVal-- > 0) {
					write(true);
					if (!(thisVal-- > 0)) break;
					write(true);
				}
				if (bptr & 1) bptr += 1;
				highRead = true;
			} else if (thisVal === 0) {
				if (!highWrite) myImg += 1;
				myImg = (myImg + 3) & ~3;
				highWrite = true;
			} else if (thisVal === 2) {
				const dx = bits[bptr++] as number;
				const dy = bits[bptr++] as number;
				let skip = dx + dy * stride - 1;
				while (skip-- > 0) out[myImg++] = 255;
			} else if (thisVal === 1) {
				break;
			}
		}
	}
	return out;
}

// RLE8 decoder ported from CDIB::Convert8ToNonRLE (dib.cpp).
function decodeRle8(
	bits: Uint8Array,
	width: number,
	height: number,
	sizeImage: number,
): Uint8Array {
	const stride = storageWidth(width, 8);
	const out = new Uint8Array(stride * height);
	const end = sizeImage > 0 ? Math.min(sizeImage, bits.length) : bits.length;
	let bptr = 0;
	let myImg = 0;

	while (bptr < end) {
		let thisVal = bits[bptr++] as number;
		if (thisVal > 0) {
			const value = bits[bptr++] as number;
			while (thisVal-- > 0) out[myImg++] = value;
		} else {
			thisVal = bits[bptr++] as number;
			if (thisVal >= 3) {
				while (thisVal-- > 0) out[myImg++] = bits[bptr++] as number;
				if (bptr & 1) bptr += 1;
			} else if (thisVal === 0) {
				myImg = (myImg + 3) & ~3;
			} else if (thisVal === 2) {
				const dx = bits[bptr++] as number;
				const dy = bits[bptr++] as number;
				let skip = dx + dy * stride - 1;
				while (skip-- > 0) out[myImg++] = 255;
			} else if (thisVal === 1) {
				break;
			}
		}
	}
	return out;
}
