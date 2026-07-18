import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { convert } from "./convert.ts";
import { numDibColorEntries, storageWidth } from "./dib.ts";
import { AF_MAGICNUM, AT_COMPLEX, parseAvb } from "./parser.ts";
import { encodePng } from "./png.ts";

const AVATAR_DIR = new URL(
	"../../../comic-chat/v1.0-pre-modern/comicart/avatars/",
	import.meta.url,
);
const BOLO = fileURLToPath(new URL("bolo.avb", AVATAR_DIR));
const ANNA = fileURLToPath(new URL("anna.avb", AVATAR_DIR));

function load(path: string): Uint8Array {
	return new Uint8Array(readFileSync(path));
}

describe("dib helpers", () => {
	it("computes 4 byte aligned storage widths", () => {
		expect(storageWidth(192, 4)).toBe(96);
		expect(storageWidth(40, 4)).toBe(20);
		expect(storageWidth(191, 8)).toBe(192);
		expect(storageWidth(1, 1)).toBe(4);
	});

	it("computes color table sizes", () => {
		expect(numDibColorEntries(4, 16)).toBe(16);
		expect(numDibColorEntries(8, 0)).toBe(256);
		expect(numDibColorEntries(1, 0)).toBe(2);
	});
});

describe("parseAvb on bolo.avb", () => {
	const parsed = parseAvb(load(BOLO));

	it("reads the old format header", () => {
		expect(parsed.magicNum).toBe(AF_MAGICNUM);
		expect(parsed.type).toBe(AT_COMPLEX);
		expect(parsed.typeName).toBe("complex");
		expect(parsed.version).toBe(1);
		expect(parsed.name).toBe("Bolo");
	});

	it("reads face and torso record counts", () => {
		expect(parsed.faces.length).toBe(12);
		expect(parsed.torsos.length).toBe(11);
		expect(parsed.bodies.length).toBe(0);
	});

	it("maps emotion indices to labels", () => {
		const first = parsed.faces[0];
		expect(first).toBeDefined();
		if (first) {
			expect(first.emotion.index).toBe(9);
			expect(first.emotion.label).toBe("neutral");
		}
	});

	it("assigns an icon pose and dedups ditto offsets", () => {
		expect(parsed.iconPoseID).toBeGreaterThan(0);
		expect(parsed.poses.length).toBeGreaterThan(0);
		for (const rec of [...parsed.faces, ...parsed.torsos]) {
			expect(rec.poseID).toBeGreaterThanOrEqual(1);
			expect(rec.poseID).toBeLessThanOrEqual(parsed.poses.length);
		}
	});
});

describe("parseAvb on anna.avb", () => {
	const parsed = parseAvb(load(ANNA));

	it("parses a complex avatar named Anna", () => {
		expect(parsed.magicNum).toBe(AF_MAGICNUM);
		expect(parsed.name).toBe("Anna");
		expect(parsed.faces.length).toBe(18);
		expect(parsed.torsos.length).toBe(16);
	});
});

describe("png encoder", () => {
	it("emits a valid signature and inflatable IDAT", () => {
		const w = 3;
		const h = 2;
		const rgba = new Uint8Array(w * h * 4).fill(200);
		const png = encodePng(w, h, rgba);
		expect(Array.from(png.subarray(0, 8))).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10,
		]);
		expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		expect(view.getUint32(16, false)).toBe(w);
		expect(view.getUint32(20, false)).toBe(h);
		let p = 8;
		let idat: Uint8Array | null = null;
		while (p < png.length) {
			const len = view.getUint32(p, false);
			const type = String.fromCharCode(
				png[p + 4] ?? 0,
				png[p + 5] ?? 0,
				png[p + 6] ?? 0,
				png[p + 7] ?? 0,
			);
			if (type === "IDAT") {
				idat = png.subarray(p + 8, p + 8 + len);
			}
			p += 12 + len;
		}
		expect(idat).not.toBeNull();
		if (idat) {
			const raw = inflateSync(idat);
			expect(raw.length).toBe((w * 4 + 1) * h);
		}
	});
});

describe("convert on bolo.avb", () => {
	const result = convert(load(BOLO), "bolo");

	it("decodes poses into RGBA sprites with plausible dimensions", () => {
		expect(result.pngs.length).toBeGreaterThan(0);
		const body = result.pngs.find((png) => png.file === "bolo_pose2.png");
		expect(body).toBeDefined();
		if (body) {
			expect(body.width).toBe(192);
			expect(body.height).toBe(156);
		}
	});

	it("records the white transparent color in metadata", () => {
		expect(result.metadata.transparentColor).toEqual({
			r: 255,
			g: 255,
			b: 255,
		});
	});
});
