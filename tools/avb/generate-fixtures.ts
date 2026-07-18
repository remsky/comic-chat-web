// Node CLI: generate the compact six-avatar runtime fixture used by panel tests.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildAvatarFixtures,
	formatAvatarFixtureSet,
	TRACE_CAST,
} from "./fixtures.ts";

const defaultAvatarDir = fileURLToPath(
	new URL(
		"../../../comic-chat/v1.0-pre-modern/comicart/avatars/",
		import.meta.url,
	),
);
const defaultOutput = fileURLToPath(
	new URL("../../test/fixtures/avatars.json", import.meta.url),
);

const avatarDir = resolve(process.argv[2] ?? defaultAvatarDir);
const output = resolve(process.argv[3] ?? defaultOutput);
const fixtures = buildAvatarFixtures(
	TRACE_CAST.map((name) => ({
		name,
		bytes: new Uint8Array(readFileSync(join(avatarDir, `${name}.avb`))),
	})),
);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, formatAvatarFixtureSet(fixtures));
process.stdout.write(
	`${fixtures.avatars.length} avatars, ${fixtures.poseCount} poses -> ${output}\n`,
);
