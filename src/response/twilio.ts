// src/response/twilio.ts
import twilio from "twilio";
import { CONFIG, requiredEnv } from "./config.js";

const twilioClient = twilio(requiredEnv("TWILIO_ACCOUNT_SID"), requiredEnv("TWILIO_AUTH_TOKEN"));

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
