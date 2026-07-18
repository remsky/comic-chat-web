// Little-endian byte reader over a raw buffer. Pure, no I/O.

export class ByteReader {
	readonly data: Uint8Array;
	private readonly view: DataView;
	pos: number;

	constructor(data: Uint8Array) {
		this.data = data;
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		this.pos = 0;
	}

	get length(): number {
		return this.data.length;
	}

	get remaining(): number {
		return this.data.length - this.pos;
	}

	seek(offset: number): void {
		this.pos = offset;
	}

	skip(count: number): void {
		this.pos += count;
	}

	u8(): number {
		const v = this.view.getUint8(this.pos);
		this.pos += 1;
		return v;
	}

	u16(): number {
		const v = this.view.getUint16(this.pos, true);
		this.pos += 2;
		return v;
	}

	i16(): number {
		const v = this.view.getInt16(this.pos, true);
		this.pos += 2;
		return v;
	}

	u32(): number {
		const v = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return v;
	}

	i32(): number {
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}

	bytes(count: number): Uint8Array {
		const out = this.data.subarray(this.pos, this.pos + count);
		this.pos += count;
		return out;
	}

	// Reads a NUL terminated single-byte string, consuming the terminator.
	cString(maxBytes: number): string {
		const start = this.pos;
		let end = start;
		const hardStop = Math.min(this.data.length, start + maxBytes);
		while (end < hardStop && this.data[end] !== 0) {
			end += 1;
		}
		const text = latin1(this.data.subarray(start, end));
		this.pos = end < this.data.length && this.data[end] === 0 ? end + 1 : end;
		return text;
	}
}

export function latin1(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) {
		s += String.fromCharCode(bytes[i] as number);
	}
	return s;
}
