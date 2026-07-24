// Port of the textpose.cpp emotion engine (v1.0-pre-modern), rule strings from chat.rc.

import {
	isAlnum,
	isDigit,
	isLower,
	isPrint,
	isPunct,
	isSpace,
	isUpper,
	toLowerAscii,
} from "./ctype.js";
import { PI } from "./vector2d.js";

export const EM_HAPPY = Math.fround((0 * 2 * PI) / 8);
export const EM_COY = Math.fround((1 * 2 * PI) / 8);
export const EM_BORED = Math.fround((2 * 2 * PI) / 8);
export const EM_SCARED = Math.fround((3 * 2 * PI) / 8);
export const EM_SAD = Math.fround((4 * 2 * PI) / 8);
export const EM_ANGRY = Math.fround((5 * 2 * PI) / 8);
export const EM_SHOUT = Math.fround((6 * 2 * PI) / 8);
export const EM_LAUGH = Math.fround((7 * 2 * PI) / 8);
export const EM_NEUTRAL = 0;
// gesture codes sit above the 0..2pi ring, so GetBodyFromEmotion's emotion > 7 skip keeps them off the wheel
export const EM_WAVE = 1001;
export const EM_POINTOTHER = 1002;
export const EM_POINTSELF = 1003;
export const EM_DOUBLEPOINT = 1004;
export const EM_SHRUG = 1005;
export const EM_3QRWALK = 1006;
export const EM_SIDEWALK = 1007;
export const EM_3QFWALK = 1008;

export const MAXEMOPTS = 10;
export const OVERRIDEBYPRIORITY = 1;
export const ADDPRIORITY = 2;

export interface EmotionOpt {
	emotion: number;
	intensity: number;
	priority: number;
}

export class EmotionOpts {
	opts: EmotionOpt[] = [];

	add(
		emotion: number,
		intensity: number,
		priority: number,
		flags: number = OVERRIDEBYPRIORITY,
	): void {
		const em = Math.fround(emotion);
		for (const opt of this.opts) {
			if (opt.emotion === em) {
				if (flags & OVERRIDEBYPRIORITY) {
					if (opt.priority < priority) {
						opt.priority = priority;
						opt.intensity = Math.fround(intensity);
					}
					return;
				}
				if (flags & ADDPRIORITY) {
					// faithful to avatar.cpp:724, which wrote max where min was surely intended
					opt.priority = Math.max(opt.priority + priority, 255);
					opt.intensity = Math.fround(Math.max(opt.intensity, intensity));
					return;
				}
			}
		}
		if (this.opts.length >= MAXEMOPTS) return;
		this.opts.push({
			emotion: em,
			intensity: Math.fround(intensity),
			priority,
		});
	}
}

// Verbatim ID_RULE_* string table entries from chat.rc, in ruleIDs order.
const DEFAULT_RULES: readonly (readonly [number, string])[] = [
	[EM_SHOUT, 'AllCaps("");9\nFindString("!!!");9'],
	[EM_LAUGH, 'CheckWord("ROTFL");11\nCheckWord("LOL");11'],
	[EM_HAPPY, 'FindString(":)");10\nFindString(":-)");10'],
	[EM_SAD, 'FindString(":(");10\nFindString(":-(");10'],
	[
		EM_POINTOTHER,
		'CheckStart("You");4\nCheckWord*("are you");8\nCheckWord*("will you");8\nCheckWord*("did you");8\nCheckWord*("aren\'t you");8\nCheckWord*("don\'t you");8',
	],
	[
		EM_POINTSELF,
		'CheckStart("I");3\nCheckWord*("i\'m");7\nCheckWord*("i will");7\nCheckWord*("i\'ll");7\nCheckWord*("i am");7',
	],
	[
		EM_WAVE,
		'CheckStart*("Hi");2\nCheckStart*("Bye");3\nCheckStart*("Hello");5\nCheckStart*("Welcome");5\nCheckStart*("Howdy");5',
	],
	[EM_COY, 'FindString(";-)");10'],
	[EM_ANGRY, '""'],
	[EM_SCARED, '""'],
	[EM_BORED, '""'],
];

interface StringUnit {
	emotion: number;
	arg: string;
	length: number;
	strength: number;
	caseSensitive: boolean;
}

function stringUnit(
	emotion: number,
	arg: string,
	strength: number,
	caseSensitive: boolean,
): StringUnit {
	return {
		emotion,
		arg: caseSensitive ? arg : toLowerAscii(arg),
		length: arg.length,
		strength,
		caseSensitive,
	};
}

export function checkForUppers(buff: string): boolean {
	let nUppers = 0;
	for (let i = 0; i < buff.length; i++) {
		const c = buff.charCodeAt(i);
		if (isLower(c)) return false;
		if (isUpper(c)) nUppers++;
	}
	return nUppers > 1;
}

export function checkWord(buff: string, substr: string): boolean {
	let loc = buff.indexOf(substr);
	while (loc >= 0) {
		if (loc === 0 || isSpace(buff.charCodeAt(loc - 1))) {
			const after = buff.charCodeAt(loc + substr.length);
			if (Number.isNaN(after) || isSpace(after) || isPunct(after)) return true;
		}
		loc = buff.indexOf(substr, loc + 1);
	}
	return false;
}

function startCompare2(sent: string, substring: string, len: number): boolean {
	return sent.startsWith(substring) && !isAlnum(sent.charCodeAt(len));
}

function isSentenceTerminator(c: number): boolean {
	return c === 0x2e || c === 0x21 || c === 0x3f;
}

function getNextSentenceStart(s: string, from: number): number | null {
	let i = from;
	while (i < s.length && !isSentenceTerminator(s.charCodeAt(i))) i++;
	if (i >= s.length) return null;
	while (i < s.length && (isPunct(s.charCodeAt(i)) || isSpace(s.charCodeAt(i))))
		i++;
	return i;
}

function readQuotedString(s: string, from: number): [string, number] {
	const first = s.indexOf('"', from);
	if (first < 0) return ["", from];
	const second = s.indexOf('"', first + 1);
	if (second < 0) return ["", from];
	return [s.slice(first + 1, second), second + 1];
}

export class EmotionEngine {
	private readonly general: StringUnit[] = [];
	private readonly word: StringUnit[] = [];
	private readonly sentence: StringUnit[] = [];
	private capsStrength = 0;
	private capsEmotion = 0;

	constructor(rules: readonly (readonly [number, string])[] = DEFAULT_RULES) {
		for (const [emotion, rule] of rules) this.loadCompositeRule(emotion, rule);
	}

	private loadCompositeRule(emotion: number, rule: string): void {
		let pos = 0;
		while (true) {
			const next = this.loadSingleRule(emotion, rule, pos);
			if (next === null || next >= rule.length) break;
			pos = next;
		}
	}

	private loadSingleRule(
		emotion: number,
		s: string,
		start: number,
	): number | null {
		let p = start;
		while (p < s.length && !isPrint(s.charCodeAt(p))) p++;
		if (p >= s.length) return null;
		const fnStart = p;
		while (p < s.length && s[p] !== "(") p++;
		const fn = s.slice(fnStart, p);
		if (p >= s.length) return null;
		p++;
		const [arg, afterArg] = readQuotedString(s, p);
		p = afterArg;
		while (p < s.length && s[p] !== ";") p++;
		if (p >= s.length) return null;
		p++;
		let digits = "";
		while (p < s.length && s[p] !== "\n") {
			// textpose.cpp:197 spins forever on a non-digit here; throwing is the only divergence
			if (!isDigit(s.charCodeAt(p)))
				throw new Error(`bad strength in rule: ${s}`);
			digits += s.charAt(p);
			p++;
		}
		const strength = digits.length > 0 ? Number.parseInt(digits, 10) : 0;
		while (p < s.length && s[p] === "\n") p++;
		this.registerRule(emotion, fn, arg, strength);
		return p;
	}

	private registerRule(
		emotion: number,
		fn: string,
		arg: string,
		strength: number,
	): void {
		const f = fn.toLowerCase();
		if (f === "allcaps") {
			this.capsStrength = strength;
			this.capsEmotion = emotion;
		} else if (f === "findstring")
			this.general.push(stringUnit(emotion, arg, strength, true));
		else if (f === "findstring*")
			this.general.push(stringUnit(emotion, arg, strength, false));
		else if (f === "checkword")
			this.word.push(stringUnit(emotion, arg, strength, true));
		else if (f === "checkword*")
			this.word.push(stringUnit(emotion, arg, strength, false));
		else if (f === "checkstart")
			this.sentence.push(stringUnit(emotion, arg, strength, true));
		else if (f === "checkstart*")
			this.sentence.push(stringUnit(emotion, arg, strength, false));
	}

	getEmotionsFromString(
		str: string,
		emOpts: EmotionOpts = new EmotionOpts(),
	): EmotionOpts {
		const buff = str;
		const lower = toLowerAscii(buff);
		emOpts.opts.length = 0;

		if (this.capsStrength && checkForUppers(buff))
			emOpts.add(this.capsEmotion, 1.0, this.capsStrength);

		for (const unit of this.general) {
			if (unit.caseSensitive) {
				if (buff.includes(unit.arg))
					emOpts.add(unit.emotion, 1.0, unit.strength);
			} else if (lower.includes(unit.arg))
				emOpts.add(unit.emotion, 1.0, unit.strength);
		}

		for (const unit of this.word) {
			if (unit.caseSensitive) {
				if (checkWord(buff, unit.arg))
					emOpts.add(unit.emotion, 1.0, unit.strength);
			} else if (checkWord(lower, unit.arg))
				emOpts.add(unit.emotion, 1.0, unit.strength);
		}

		let bptr = 0;
		while (bptr < buff.length && isSpace(buff.charCodeAt(bptr))) bptr++;
		let cursor: number | null = bptr;
		while (cursor !== null && cursor < buff.length) {
			// faithful bug from textpose.cpp:306: each sentence iteration tests the string start, never the sentence itself
			for (const unit of this.sentence) {
				if (unit.caseSensitive) {
					if (startCompare2(buff, unit.arg, unit.length))
						emOpts.add(unit.emotion, 1.0, unit.strength);
				} else if (startCompare2(lower, unit.arg, unit.length))
					emOpts.add(unit.emotion, 1.0, unit.strength);
			}
			cursor = getNextSentenceStart(buff, cursor);
		}

		return emOpts;
	}
}
