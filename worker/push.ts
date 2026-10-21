// Web Push sender: RFC 8291 aes128gcm payload encryption plus RFC 8292 VAPID, WebCrypto only.

import { base64urlDecode, base64urlEncode } from "../src/protocol/base64url.js";

export interface PushTarget {
	endpoint: string;
	// subscription keys as the browser hands them out: base64url point and auth secret
	p256dh: string;
	auth: string;
}

export interface VapidConfig {
	// base64url 65-byte uncompressed P-256 point / 32-byte private scalar, the `web-push` key format
	publicKey: string;
	privateKey: string;
	// mailto: or https: contact the push service may use to reach the operator
	subject: string;
}

// WebCrypto wants plain-ArrayBuffer views; this alias keeps the signatures honest
type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
// TextEncoder always allocates a plain buffer; the lib type just doesn't say so
const utf8 = (text: string): Bytes => encoder.encode(text) as Bytes;

function concat(...parts: Uint8Array[]): Bytes {
	const whole = new Uint8Array(
		parts.reduce((length, part) => length + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		whole.set(part, offset);
		offset += part.length;
	}
	return whole;
}

async function hkdf(
	salt: Bytes,
	ikm: Bytes,
	info: Bytes,
	bytes: number,
): Promise<Bytes> {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt, info },
			key,
			bytes * 8,
		),
	);
}

// RFC 8291 §3.4 record; keys and salt are parameters so the Appendix A vector can pin them
export async function encryptWith(
	plaintext: Bytes,
	target: Pick<PushTarget, "p256dh" | "auth">,
	senderKeys: CryptoKeyPair,
	salt: Bytes,
): Promise<Bytes> {
	const uaPublic = base64urlDecode(target.p256dh);
	const authSecret = base64urlDecode(target.auth);
	const asPublic = new Uint8Array(
		// workerd types return ArrayBuffer | JsonWebKey regardless of format; "raw" is bytes
		(await crypto.subtle.exportKey("raw", senderKeys.publicKey)) as ArrayBuffer,
	);
	const uaKey = await crypto.subtle.importKey(
		"raw",
		uaPublic,
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	const ecdhSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			// workerd's generated types misspell the standard `public` field as `$public`; the runtime takes this shape
			{ name: "ECDH", public: uaKey } as unknown as Parameters<
				typeof crypto.subtle.deriveBits
			>[0],
			senderKeys.privateKey,
			256,
		),
	);
	const ikm = await hkdf(
		authSecret,
		ecdhSecret,
		concat(utf8("WebPush: info\0"), uaPublic, asPublic),
		32,
	);
	const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
	const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
		"encrypt",
	]);
	// one record: payload plus the 0x02 last-record delimiter
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: nonce },
			aesKey,
			concat(plaintext, Uint8Array.of(2)),
		),
	);
	// header: salt(16) | rs(4) | idlen(1) | keyid(65)
	const header = new Uint8Array(21 + asPublic.length);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = asPublic.length;
	header.set(asPublic, 21);
	return concat(header, ciphertext);
}

export async function encryptPayload(
	plaintext: Bytes,
	target: Pick<PushTarget, "p256dh" | "auth">,
): Promise<Bytes> {
	// workerd types leave generateKey at CryptoKey | CryptoKeyPair; EC algorithms always pair
	const senderKeys = (await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveBits"],
	)) as CryptoKeyPair;
	return encryptWith(
		plaintext,
		target,
		senderKeys,
		crypto.getRandomValues(new Uint8Array(16)),
	);
}

interface CachedJwt {
	header: string;
	expires: number;
}

// one signed token covers every push to that service for hours; cached per origin
const jwtCache = new Map<string, CachedJwt>();
const JWT_LIFE_MS = 12 * 60 * 60 * 1000;

async function vapidHeader(
	endpoint: string,
	vapid: VapidConfig,
): Promise<string> {
	const audience = new URL(endpoint).origin;
	// keyed on the signing key too, so a rotated key never rides a stale token
	const cacheKey = `${audience} ${vapid.publicKey}`;
	const cached = jwtCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) return cached.header;
	const publicBytes = base64urlDecode(vapid.publicKey);
	const jwk: JsonWebKey = {
		kty: "EC",
		crv: "P-256",
		d: vapid.privateKey,
		x: base64urlEncode(publicBytes.slice(1, 33)),
		y: base64urlEncode(publicBytes.slice(33, 65)),
	};
	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const expires = Date.now() + JWT_LIFE_MS;
	const signing = `${base64urlEncode(
		utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })),
	)}.${base64urlEncode(
		utf8(
			JSON.stringify({
				aud: audience,
				exp: Math.floor(expires / 1000),
				sub: vapid.subject,
			}),
		),
	)}`;
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			key,
			utf8(signing),
		),
	);
	const header = `vapid t=${signing}.${base64urlEncode(signature)}, k=${vapid.publicKey}`;
	jwtCache.set(cacheKey, { header, expires: Date.now() + JWT_LIFE_MS / 2 });
	return header;
}

export interface PushOptions {
	// push services collapse queued pushes sharing a topic, so an offline device wakes to one notification
	topic?: string;
	ttlSeconds?: number;
}

// delivers one encrypted push; resolves to the service's status code (404/410 mean the subscription is gone)
export async function sendPush(
	target: PushTarget,
	payload: string,
	vapid: VapidConfig,
	options: PushOptions = {},
): Promise<number> {
	const body = await encryptPayload(utf8(payload), target);
	const response = await fetch(target.endpoint, {
		method: "POST",
		headers: {
			Authorization: await vapidHeader(target.endpoint, vapid),
			"Content-Encoding": "aes128gcm",
			"Content-Type": "application/octet-stream",
			TTL: String(options.ttlSeconds ?? 4 * 60 * 60),
			Urgency: "normal",
			// RFC 8030 caps Topic at 32 base64url characters
			...(options.topic !== undefined
				? { Topic: options.topic.slice(0, 32) }
				: {}),
		},
		body,
		// push services never redirect; following one would relay the POST elsewhere (workerd has no "error" mode)
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
	});
	// the push service's body is irrelevant; drain it so the connection can be reused
	await response.body?.cancel();
	return response.status;
}
