// src/response/utils.ts
export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(s: string, max = 1500): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

/**
 * Backoff for outbound sends:
 * delaySeconds = min(600, 5 * 2^attempts)
 * attemptsAfterIncrement: 1 => 10s, 2 => 20s, 3 => 40s, ...
 */
export function computeSendBackoffSeconds(attemptsAfterIncrement: number): number {
    const delay = 5 * Math.pow(2, attemptsAfterIncrement);
    return Math.min(600, Math.floor(delay));
}
