// src/response/sendWithTyping.ts (or inline in your worker)
import { sendViaTwilio, sendWhatsAppTypingIndicator } from "./twilio.js";

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function computeTypingDelayMs(body: string): number {
    const len = body.trim().length;
    const normalized = Math.log1p(len) / Math.log1p(400);
    const base = 1000 + normalized * 4000;
    const jitter = (Math.random() - 0.5) * 300;
    return Math.round(clamp(base + jitter, 2000, 7000));
}

export async function sendWithTyping(opts: {
    to: string;
    from: string;
    body: string;
    provider_inbound_sid?: string | null;
}) {
    const isWhatsApp = opts.to.startsWith("whatsapp:") || opts.from.startsWith("whatsapp:");

    if (isWhatsApp && opts.provider_inbound_sid) {
        // fire typing immediately
        await sendWhatsAppTypingIndicator({ provider_inbound_sid: opts.provider_inbound_sid });

        // hold 1-5s based on message size
        const delayMs = computeTypingDelayMs(opts.body);
        await sleep(delayMs);
    }

    return sendViaTwilio({ to: opts.to, from: opts.from, body: opts.body });
}
