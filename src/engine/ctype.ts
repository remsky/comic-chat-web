// ASCII C-locale ctype matching MSVC semantics; out-of-range codes (including NaN from charCodeAt past the end) are all false.

export function isSpace(c: number): boolean {
	return c === 32 || (c >= 9 && c <= 13);
}

export function isUpper(c: number): boolean {
	return c >= 65 && c <= 90;
}

export function isLower(c: number): boolean {
	return c >= 97 && c <= 122;
}

export function isDigit(c: number): boolean {
	return c >= 48 && c <= 57;
}

export function isAlnum(c: number): boolean {
	return isDigit(c) || isUpper(c) || isLower(c);
}

export function isPunct(c: number): boolean {
	return c >= 33 && c <= 126 && !isAlnum(c);
}

export function isPrint(c: number): boolean {
	return c >= 32 && c <= 126;
}

export function toLowerAscii(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		out += isUpper(c) ? String.fromCharCode(c + 32) : s.charAt(i);
	}
	return out;
}
