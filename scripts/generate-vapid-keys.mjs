// Prints a fresh VAPID key pair in the base64url format worker/push.ts expects.
const pair = await crypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(
	await crypto.subtle.exportKey("raw", pair.publicKey),
);
console.log(`VAPID_PUBLIC_KEY=${Buffer.from(raw).toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
