// src/response/twilio.ts
import twilio from "twilio";
import { CONFIG, requiredEnv } from "./config.js";

const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
const twilioClient = twilio(accountSid, authToken);

export async function sendWhatsAppTypingIndicator(opts: {
    provider_inbound_sid: string;
}): Promise<void> {
    const url = "https://messaging.twilio.com/v2/Indicators/Typing.json";

    const body = new URLSearchParams({
        messageId: opts.provider_inbound_sid,
        channel: "whatsapp",
    });

    const ac = new AbortController();
    const timeout = setTimeout(
        () => ac.abort(),
        CONFIG.TWILIO_TYPING_TIMEOUT_MS ?? 4000
    );

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
            signal: ac.signal,
        });

        // non-fatal UX call
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn("Typing indicator failed:", res.status, text);
        }
    } catch (e: any) {
        console.warn("Typing indicator error:", e?.message ?? e);
    } finally {
        clearTimeout(timeout);
        console.log("Cleared Typing Window endpoint")
    }
}

export async function sendViaTwilio(opts: { to: string; from: string; body: string }): Promise<string> {
    const sendPromise = twilioClient.messages.create({
        to: opts.to,
        from: opts.from,
        body: opts.body,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
            () => reject(new Error(`Twilio send timeout after ${CONFIG.TWILIO_SEND_TIMEOUT_MS}ms`)),
            CONFIG.TWILIO_SEND_TIMEOUT_MS
        )
    );

    const msg = await Promise.race([sendPromise, timeoutPromise]);
    return msg.sid;
}
