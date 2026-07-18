// Minimal RGBA PNG encoder using node:zlib deflate and hand rolled chunks.

import { deflateSync } from "node:zlib";

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
}

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length, false);
	out[4] = type.charCodeAt(0);
	out[5] = type.charCodeAt(1);
	out[6] = type.charCodeAt(2);
	out[7] = type.charCodeAt(3);
	out.set(data, 8);
	const crc = crc32(out.subarray(4, 8 + data.length));
	view.setUint32(8 + data.length, crc, false);
	return out;
}

// rgba is width*height*4 bytes, row major top to bottom.
export function encodePng(
	width: number,
	height: number,
	rgba: Uint8Array,
): Uint8Array {
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

	const ihdr = new Uint8Array(13);
	const ihv = new DataView(ihdr.buffer);
	ihv.setUint32(0, width, false);
	ihv.setUint32(4, height, false);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		raw.set(
			rgba.subarray(y * stride, y * stride + stride),
			y * (stride + 1) + 1,
		);
	}
	const idat = deflateSync(raw, { level: 9 });

	const ihdrChunk = chunk("IHDR", ihdr);
	const idatChunk = chunk(
		"IDAT",
		new Uint8Array(idat.buffer, idat.byteOffset, idat.byteLength),
	);
	const iendChunk = chunk("IEND", new Uint8Array(0));

	const total =
		sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	const out = new Uint8Array(total);
	let p = 0;
	out.set(sig, p);
	p += sig.length;
	out.set(ihdrChunk, p);
	p += ihdrChunk.length;
	out.set(idatChunk, p);
	p += idatChunk.length;
	out.set(iendChunk, p);
	return out;
}
