// Generates one request-efficient transparent avatar atlas per cast member and the runtime manifest.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeImageRgba, decodePose } from "./convert.ts";
import {
	buildAvatarFixtures,
	FULL_CAST,
	formatAvatarFixtureSet,
} from "./fixtures.ts";
import { parseAvb } from "./parser.ts";
import { encodePng } from "./png.ts";

const MAX_ATLAS_WIDTH = 1024;
const PADDING = 1;

interface DecodedSprite {
	localPoseID: number;
	width: number;
	height: number;
	rgba: Uint8Array;
	x: number;
	y: number;
}

function pack(sprites: DecodedSprite[]): { width: number; height: number } {
	let x = PADDING;
	let y = PADDING;
	let rowHeight = 0;
	let usedWidth = 0;
	for (const sprite of sprites) {
		if (x > PADDING && x + sprite.width + PADDING > MAX_ATLAS_WIDTH) {
			x = PADDING;
			y += rowHeight + PADDING;
			rowHeight = 0;
		}
		sprite.x = x;
		sprite.y = y;
		x += sprite.width + PADDING;
		rowHeight = Math.max(rowHeight, sprite.height);
		usedWidth = Math.max(usedWidth, x);
	}
	return {
		width: Math.max(1, usedWidth),
		height: Math.max(1, y + rowHeight + PADDING),
	};
}

function buildAtlas(
	sprites: DecodedSprite[],
	width: number,
	height: number,
): Uint8Array {
	const atlas = new Uint8Array(width * height * 4);
	for (const sprite of sprites) {
		for (let row = 0; row < sprite.height; row++) {
			const sourceStart = row * sprite.width * 4;
			const targetStart = ((sprite.y + row) * width + sprite.x) * 4;
			atlas.set(
				sprite.rgba.subarray(sourceStart, sourceStart + sprite.width * 4),
				targetStart,
			);
		}
	}
	return atlas;
}

const avatarDir = resolve(
	process.argv[2] ??
		fileURLToPath(
			new URL(
				"../../../comic-chat/v1.0-pre-modern/comicart/avatars/",
				import.meta.url,
			),
		),
);
const outputDir = resolve(
	process.argv[3] ??
		fileURLToPath(new URL("../../public/assets/avatars/", import.meta.url)),
);
const inputs = FULL_CAST.map((name) => ({
	name,
	bytes: new Uint8Array(readFileSync(join(avatarDir, `${name}.avb`))),
}));
const fixtures = buildAvatarFixtures(inputs);
mkdirSync(outputDir, { recursive: true });

for (let avatarIndex = 0; avatarIndex < inputs.length; avatarIndex++) {
	const input = inputs[avatarIndex];
	const avatar = fixtures.avatars[avatarIndex];
	if (!input || !avatar) continue;
	const sprites: DecodedSprite[] = [];
	const parsed = parseAvb(input.bytes);
	for (const pose of parsed.poses) {
		const decoded = decodePose(input.bytes, pose, parsed.globalPalette);
		if (!decoded.image)
			throw new Error(
				`${input.name} pose ${pose.poseID}: ${decoded.imageError}`,
			);
		sprites.push({
			localPoseID: pose.poseID,
			width: decoded.image.width,
			height: decoded.image.height,
			rgba: composeImageRgba(decoded.image, decoded.mask),
			x: 0,
			y: 0,
		});
	}
	const size = pack(sprites);
	const atlasFile = `${input.name}.png`;
	writeFileSync(
		join(outputDir, atlasFile),
		encodePng(
			size.width,
			size.height,
			buildAtlas(sprites, size.width, size.height),
		),
	);
	for (const pose of avatar.poses) {
		const sprite = sprites.find(
			(candidate) => candidate.localPoseID === pose.localPoseID,
		);
		if (!sprite)
			throw new Error(`missing ${input.name} pose ${pose.localPoseID}`);
		pose.sprite = {
			atlasUrl: `/assets/avatars/${atlasFile}`,
			x: sprite.x,
			y: sprite.y,
		};
	}
}

writeFileSync(
	join(outputDir, "manifest.json"),
	formatAvatarFixtureSet(fixtures),
);
process.stdout.write(
	`${fixtures.avatars.length} avatar atlases, ${fixtures.poseCount} poses -> ${outputDir}\n`,
);
