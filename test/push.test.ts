import { afterEach, describe, expect, it, vi } from "vitest";
import { base64urlDecode, base64urlEncode } from "../src/protocol/base64url.js";
import {
	encryptPayload,
	encryptWith,
	sendPush,
	type VapidConfig,
} from "../worker/push.js";

// RFC 8291 Appendix A: the complete worked example, fixed sender key and salt included
const VECTOR = {
	plaintext: "When I grow up, I want to be a watermelon",
	uaPublic:
		"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
	authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
	asPublic:
		"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
	asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
	salt: "DGv6ra1nlYgDCS1FRnbzlw",
	message:
		"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("web push payload encryption", () => {
	it("reproduces the RFC 8291 Appendix A message byte for byte", async () => {
		const asPublicBytes = base64urlDecode(VECTOR.asPublic);
		const point = {
			kty: "EC",
			crv: "P-256",
			x: base64urlEncode(asPublicBytes.slice(1, 33)),
			y: base64urlEncode(asPublicBytes.slice(33, 65)),
		};
		const ecdh = { name: "ECDH", namedCurve: "P-256" };
		const body = await encryptWith(
			new TextEncoder().encode(VECTOR.plaintext),
			{ p256dh: VECTOR.uaPublic, auth: VECTOR.authSecret },
			{
				privateKey: await crypto.subtle.importKey(
					"jwk",
					{ ...point, d: VECTOR.asPrivate },
					ecdh,
					false,
					["deriveBits"],
				),
				publicKey: await crypto.subtle.importKey("jwk", point, ecdh, true, []),
			},
			base64urlDecode(VECTOR.salt),
		);
		expect(base64urlEncode(body)).toBe(VECTOR.message);
	});

	it("random sender keys still produce a well-formed aes128gcm header", async () => {
		const body = await encryptPayload(new TextEncoder().encode("hi"), {
			p256dh: VECTOR.uaPublic,
			auth: VECTOR.authSecret,
		});
		// salt(16) | rs(4) | idlen(1) | key(65) | ciphertext(2 + 1 delimiter + 16 tag)
		expect(body.length).toBe(16 + 4 + 1 + 65 + 19);
		expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
		expect(body[20]).toBe(65);
		expect(body[21]).toBe(4);
	});
});

describe("web push delivery", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends a signed, encrypted push the service can attribute", async () => {
		const pair = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const publicRaw = new Uint8Array(
			await crypto.subtle.exportKey("raw", pair.publicKey),
		);
		const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
		const vapid: VapidConfig = {
			publicKey: base64urlEncode(publicRaw),
			privateKey: privateJwk.d as string,
			subject: "mailto:op@example.com",
		};
		const seen: { url?: string; init?: RequestInit } = {};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				seen.url = url;
				seen.init = init;
				return new Response(null, { status: 201 });
			}),
		);
		const status = await sendPush(
			{
				endpoint: "https://push.example.com/send/abc",
				p256dh: VECTOR.uaPublic,
				auth: VECTOR.authSecret,
			},
			JSON.stringify({ room: "lobby" }),
			vapid,
			{ topic: "lobby" },
		);
		expect(status).toBe(201);
		expect(seen.url).toBe("https://push.example.com/send/abc");
		const headers = seen.init?.headers as Record<string, string>;
		expect(headers["Content-Encoding"]).toBe("aes128gcm");
		expect(headers.Topic).toBe("lobby");
		expect(Number(headers.TTL)).toBeGreaterThan(0);
		const auth = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=(.+)$/.exec(
			headers.Authorization ?? "",
		);
		const [, token = "", carriedKey = ""] = auth ?? [];
		expect(carriedKey).toBe(vapid.publicKey);
		const [header = "", claims = "", signature = ""] = token.split(".");
		expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
			typ: "JWT",
			alg: "ES256",
		});
		const parsedClaims = JSON.parse(
			Buffer.from(claims, "base64url").toString(),
		) as Record<string, unknown>;
		expect(parsedClaims.aud).toBe("https://push.example.com");
		expect(parsedClaims.sub).toBe(vapid.subject);
		expect(parsedClaims.exp as number).toBeGreaterThan(Date.now() / 1000);
		expect(
			await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				pair.publicKey,
				base64urlDecode(signature),
				new TextEncoder().encode(`${header}.${claims}`),
			),
		).toBe(true);
	});
});
