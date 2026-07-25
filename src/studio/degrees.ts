// Which emotion intensities reach different pose art, so the picker never offers the same drawing twice.

import {
	type Avatar,
	type AvatarBody,
	type AvatarData,
	AvatarRegistry,
} from "../engine/avatar.js";

const PROBE_STEPS = 20;

function poseKey(data: AvatarData, body: AvatarBody): string {
	if (body.kind === "simple")
		return String(data.bodies[body.bodyIndex]?.poseID ?? -1);
	return `${data.faces[body.faceIndex]?.poseID ?? -1}/${
		data.torsos[body.torsoIndex]?.poseID ?? -1
	}`;
}

// one intensity per distinct pose, mildest first; art that only repeats the neutral drawing yields none
export function emotionDegrees(avatar: Avatar, angle: number): number[] {
	const { data } = avatar;
	const neutral = poseKey(data, avatar.getBodyFromEmotion(0, 0));
	const order: string[] = [];
	const spans = new Map<string, number[]>();
	for (let step = 1; step <= PROBE_STEPS; step++) {
		const intensity = step / PROBE_STEPS;
		const key = poseKey(data, avatar.getBodyFromEmotion(angle, intensity));
		if (key === neutral) continue;
		const span = spans.get(key);
		if (span) span.push(intensity);
		else {
			spans.set(key, [intensity]);
			order.push(key);
		}
	}
	// the middle of the band a pose wins over, so the stored value sits clear of its neighbours' edges
	return order.map((key) => {
		const span = spans.get(key) ?? [1];
		const low = span[0] ?? 1;
		const high = span[span.length - 1] ?? low;
		return Math.round(((low + high) / 2) * 100) / 100;
	});
}

export type EmotionDegrees = Record<string, number[]>;

// emotion key -> its degrees, dropping the emotions this character cannot express
function avatarDegrees(
	data: AvatarData,
	angles: readonly (readonly [string, number])[],
): EmotionDegrees {
	const [avatar] = new AvatarRegistry([data]).avatars;
	if (!avatar) return {};
	return Object.fromEntries(
		angles
			.map(([key, angle]) => [key, emotionDegrees(avatar, angle)] as const)
			.filter(([, degrees]) => degrees.length > 0),
	);
}

// probed on first ask and kept, so a strip that casts three characters never poses the other twenty-eight
export function emotionDegreeCache(
	avatars: readonly AvatarData[],
	angles: readonly (readonly [string, number])[],
): (name: string) => EmotionDegrees {
	const cache = new Map<string, EmotionDegrees>();
	return (name) => {
		const cached = cache.get(name);
		if (cached) return cached;
		const data = avatars.find((entry) => entry.name === name);
		const computed = data ? avatarDegrees(data, angles) : {};
		cache.set(name, computed);
		return computed;
	};
}
