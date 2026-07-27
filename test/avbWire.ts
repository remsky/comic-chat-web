import { expect } from "vitest";

// the emotion ring avatario.cpp writes: index * 2 * PI / 8 at vector2d.h's PI of 3.14159, gesture codes above it
const WIRE_EMOTIONS = [
	0, 0, 0.7853975296020508, 1.5707950592041016, 2.3561925888061523,
	3.141590118408203, 3.926987409591675, 4.712385177612305, 5.4977827072143555,
	0, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008,
];

// (BYTE)(m_intensity * 10) truncates, so 0.898 keeps 8 and never rounds up to 9
const WIRE_TENTHS = new Map([
	[0, 0],
	[0.09803921729326248, 0],
	[0.20000000298023224, 2],
	[0.2980392277240753, 2],
	[0.4000000059604645, 4],
	[0.49803921580314636, 4],
	[0.6000000238418579, 6],
	[0.6980392336845398, 6],
	[0.800000011920929, 8],
	[0.8980392217636108, 8],
	[1, 10],
]);

export interface WireRecord {
	emotion: number;
	emotionIndex: number;
	intensity: number;
	intensityTenths: number;
}

// written out rather than recomputed, so a wrong conversion in tools/avb cannot supply its own expectation
export function expectWireRecords(records: readonly WireRecord[]): void {
	for (const rec of records) {
		expect(Number.isInteger(rec.emotionIndex)).toBe(true);
		expect(WIRE_EMOTIONS[rec.emotionIndex]).toBe(rec.emotion);
		expect(WIRE_TENTHS.get(rec.intensity)).toBe(rec.intensityTenths);
	}
}
