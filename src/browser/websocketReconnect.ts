const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000] as const;

const CLOSE_LABELS: Readonly<Record<number, string>> = {
	1000: "connection closed",
	1001: "server went away",
	1002: "protocol error",
	1003: "unsupported message",
	1006: "connection lost",
	1007: "invalid message",
	1008: "policy violation",
	1009: "message too large",
	1011: "server error",
	1012: "server restarting",
	1013: "server busy",
	1014: "gateway error",
};

const NON_RETRYABLE_CODES = new Set([1000, 1002, 1003, 1007, 1008, 1009]);

export function reconnectDelay(attempt: number): number {
	return (
		RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 10_000
	);
}

export function shouldReconnect(code: number): boolean {
	return !NON_RETRYABLE_CODES.has(code);
}

export function describeWebSocketClose(code: number, reason: string): string {
	const detail = reason.trim();
	if (detail) return detail;
	return CLOSE_LABELS[code] ?? `connection closed (${code})`;
}
