// Every drawing a character owns, under a name: "<emotion>_<n>" for faces, that or a gesture command for torsos.

import { GESTURE_EMOTIONS } from "../browser/gestures.js";
import {
	type Avatar,
	type AvatarBody,
	type AvatarData,
	AvatarRegistry,
} from "../engine/avatar.js";

const PROBE_STEPS = 20;

export const NEUTRAL_KEY = "neutral";

export interface NamedBody {
	face: number;
	torso: number;
}

// one probed intensity: the face name the wheel landed on there, and the torso it paired under it
export interface ArtProbe {
	intensity: number;
	name: string;
	torso: number;
}

export interface AvatarArt {
	// "happy_2", plus the bare "happy" for whichever the engine reaches on its own
	faces: Record<string, NamedBody>;
	// gesture commands and "<emotion>_<n>", to the torso each swaps in
	torsos: Record<string, number>;
	// emotion -> how many faces it names
	counts: Record<string, number>;
	// emotion -> the emotion it draws the same faces as
	aliases: Record<string, string>;
	// what the wheel drew across the slider, kept only to import strips written before the names existed
	probes: Record<string, ArtProbe[]>;
}

export function emptyArt(): AvatarArt {
	return { faces: {}, torsos: {}, counts: {}, aliases: {}, probes: {} };
}

// a simple avatar draws one sprite, so its face and its torso are the same record
function faceRecords(data: AvatarData) {
	return data.type === "complex" ? data.faces : data.bodies;
}

function torsoRecords(data: AvatarData) {
	return data.type === "complex" ? data.torsos : data.bodies;
}

function indicesOf(body: AvatarBody): NamedBody {
	return body.kind === "simple"
		? { face: body.bodyIndex, torso: body.bodyIndex }
		: { face: body.faceIndex, torso: body.torsoIndex };
}

// "happy_2" -> happy, 2; a bare name carries no index
export function splitArtName(name: string): { base: string; index?: number } {
	const match = /^([a-z]+)_(\d+)$/.exec(name);
	if (!match?.[1] || !match[2]) return { base: name };
	return { base: match[1], index: Number(match[2]) };
}

interface Run {
	pose: number;
	lo: number;
	hi: number;
}

// the intensity bands each distinct face wins, in the order they are first reached
function probeRuns(avatar: Avatar, angle: number, neutralPose: number): Run[] {
	const records = faceRecords(avatar.data);
	const runs: Run[] = [];
	for (let step = 1; step <= PROBE_STEPS; step++) {
		const intensity = step / PROBE_STEPS;
		const body = indicesOf(avatar.getBodyFromEmotion(angle, intensity));
		const pose = records[body.face]?.poseID ?? -1;
		if (pose === neutralPose) continue;
		const last = runs[runs.length - 1];
		if (last && last.pose === pose) last.hi = intensity;
		else runs.push({ pose, lo: intensity, hi: intensity });
	}
	// a face that wins two separate bands keeps the wider one, so the midpoint never lands in the gap between them
	const widest = new Map<number, Run>();
	for (const run of runs) {
		const held = widest.get(run.pose);
		if (!held || run.hi - run.lo > held.hi - held.lo) widest.set(run.pose, run);
	}
	return [...widest.values()].sort((a, b) => a.lo - b.lo);
}

// every step of the slider under one name, so a raw intensity resolves to the drawing it stood on and not the nearest degree
function probeTable(
	avatar: Avatar,
	angle: number,
	key: string,
	runs: readonly Run[],
): ArtProbe[] {
	const records = faceRecords(avatar.data);
	// run i is what name() called "<key>_<i+1>"; a step outside them all stood on the neutral face
	const named = new Map(runs.map((run, i) => [run.pose, `${key}_${i + 1}`]));
	const probes: ArtProbe[] = [];
	for (let step = 0; step <= PROBE_STEPS; step++) {
		const intensity = step / PROBE_STEPS;
		const body = indicesOf(avatar.getBodyFromEmotion(angle, intensity));
		probes.push({
			intensity,
			name: named.get(records[body.face]?.poseID ?? -1) ?? NEUTRAL_KEY,
			torso: body.torso,
		});
	}
	return probes;
}

function torsoKey(
	emotion: number,
	intensity: number,
	angles: readonly (readonly [string, number])[],
): string {
	if (emotion === 0 && intensity === 0) return NEUTRAL_KEY;
	for (const [key, angle] of angles)
		if (Math.abs(angle - emotion) < 1e-3) return key;
	return NEUTRAL_KEY;
}

function namedTorsos(
	data: AvatarData,
	angles: readonly (readonly [string, number])[],
): Record<string, number> {
	const byCode = new Map([...GESTURE_EMOTIONS].map(([name, em]) => [em, name]));
	const torsos: Record<string, number> = {};
	const seen = new Map<string, number>();
	torsoRecords(data).forEach((record, index) => {
		const gesture = byCode.get(record.emotion);
		if (gesture !== undefined) {
			torsos[gesture] = index;
			return;
		}
		const key = torsoKey(record.emotion, record.intensity, angles);
		const nth = (seen.get(key) ?? 0) + 1;
		seen.set(key, nth);
		torsos[`${key}_${nth}`] = index;
		// the first at a coordinate is the one the wheel's scan settles on, so it answers to the bare name too
		if (nth === 1) torsos[key] = index;
	});
	return torsos;
}

function avatarArt(
	data: AvatarData,
	angles: readonly (readonly [string, number])[],
): AvatarArt {
	const [avatar] = new AvatarRegistry([data]).avatars;
	if (!avatar) return emptyArt();
	const art = emptyArt();
	const records = faceRecords(data);
	const neutral = indicesOf(avatar.getBodyFromEmotion(0, 0));
	const neutralPose = records[neutral.face]?.poseID ?? -1;
	const reached = new Set<number>([neutralPose]);
	const owners = new Map<string, string>();

	// bare names the drawing the engine reaches unasked: the strongest of a wheel emotion, the first of the neutrals
	const name = (key: string, bodies: NamedBody[], bare: NamedBody): void => {
		bodies.forEach((body, i) => {
			art.faces[`${key}_${i + 1}`] = body;
		});
		art.faces[key] = bare;
		art.counts[key] = bodies.length;
	};

	for (const [key, angle] of angles) {
		const runs = probeRuns(avatar, angle, neutralPose);
		if (runs.length === 0) continue;
		const steps = runs.map(
			(run) => Math.round(((run.lo + run.hi) / 2) * 100) / 100,
		);
		const bodies = steps.map((step) =>
			indicesOf(avatar.getBodyFromEmotion(angle, step)),
		);
		for (const body of bodies) reached.add(records[body.face]?.poseID ?? -1);
		const strongest = bodies[bodies.length - 1];
		if (!strongest) continue;
		name(key, bodies, strongest);
		art.probes[key] = probeTable(avatar, angle, key, runs);
		const signature = runs.map((run) => run.pose).join(",");
		const owner = owners.get(signature);
		if (owner === undefined) owners.set(signature, key);
		else art.aliases[key] = owner;
	}

	// a drawing no angle reaches lost a tie at the wheel's centre, which makes it another neutral
	const extras: NamedBody[] = [];
	const seen = new Set<number>([neutralPose]);
	records.forEach((record, index) => {
		if (seen.has(record.poseID)) return;
		seen.add(record.poseID);
		if (reached.has(record.poseID)) return;
		// a simple avatar draws one sprite, so an extra face is its own torso
		extras.push({
			face: index,
			torso: data.type === "complex" ? neutral.torso : index,
		});
	});
	name(NEUTRAL_KEY, [neutral, ...extras], neutral);

	art.torsos = namedTorsos(data, angles);
	return art;
}

// probed on first ask and kept, so a strip that casts three characters never poses the other twenty-eight
export function avatarArtCache(
	avatars: readonly AvatarData[],
	angles: readonly (readonly [string, number])[],
): (name: string) => AvatarArt {
	const cache = new Map<string, AvatarArt>();
	return (name) => {
		const cached = cache.get(name);
		if (cached) return cached;
		const data = avatars.find((entry) => entry.name === name);
		const computed = data ? avatarArt(data, angles) : emptyArt();
		cache.set(name, computed);
		return computed;
	};
}

// the published name of a torso, which is the indexed one; the bare alias never reaches a script
function torsoName(art: AvatarArt, index: number): string | undefined {
	for (const [name, torso] of Object.entries(art.torsos))
		if (torso === index && (GESTURE_EMOTIONS.has(name) || /_\d+$/.test(name)))
			return name;
	return undefined;
}

export interface ArtNames {
	emotion: string;
	gesture?: string;
}

// the drawing a pre-name strip's raw intensity stood on, face and torso both, so importing one keeps its art
export function nearestArtName(
	art: AvatarArt,
	emotion: string,
	intensity: number,
): ArtNames {
	const probes = art.probes[emotion];
	let best = probes?.[0];
	if (!best) return { emotion };
	for (const probe of probes ?? [])
		if (
			Math.abs(probe.intensity - intensity) <
			Math.abs(best.intensity - intensity)
		)
			best = probe;
	// a face name draws the torso the wheel paired at its own degree, so any other one has to be named outright
	if (art.faces[best.name]?.torso === best.torso) return { emotion: best.name };
	const gesture = torsoName(art, best.torso);
	return gesture === undefined
		? { emotion: best.name }
		: { emotion: best.name, gesture };
}
