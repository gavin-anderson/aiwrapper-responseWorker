// src/response/config.ts
import crypto from "crypto";

export function requiredEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

export const CONFIG = {
    WORKER_ID: process.env.WORKER_ID ?? `response-worker-${crypto.randomUUID()}`,
    POLL_MS: parseInt(process.env.SEND_WORKER_POLL_MS ?? "500", 10),
    STALE_LOCK_SECONDS: parseInt(process.env.OUTBOUND_STALE_LOCK_SECONDS ?? "120", 10),
    TWILIO_SEND_TIMEOUT_MS: parseInt(process.env.TWILIO_SEND_TIMEOUT_MS ?? "1500", 10),
    TWILIO_TYPING_TIMEOUT_MS: parseInt(process.env.TWILIO_TYPING_TIMEOUT_MS ?? "4000", 10),
};
