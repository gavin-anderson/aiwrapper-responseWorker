// src/response/processor.ts
import { pool } from "../db/pool.js";
import type { OutboundRow } from "./types.js";
import { markOutboundSent } from "./repo.js";
import { sendWithTyping } from "./sendWithTyping.js";

export async function processOutbound(outbound: OutboundRow, log: (s: string) => void) {
    // Defensive: if already sent, mark sent.
    if (outbound.provider_outbound_sid) {
        log(`Outbound ${outbound.id} already has SID; marking sent defensively.`);
        const c = await pool.connect();
        try {
            await c.query("BEGIN");
            await markOutboundSent(c, outbound.id, outbound.provider_outbound_sid);
            await c.query("COMMIT");
        } catch (e) {
            await c.query("ROLLBACK");
            throw e;
        } finally {
            c.release();
        }
        return { sid: outbound.provider_outbound_sid };
    }

    // Send via Twilio
    const sid = await sendWithTyping({
        to: outbound.to_address,
        from: outbound.from_address,
        body: outbound.body,

        // IMPORTANT: inbound Twilio MessageSid (SM...)
        // Either stored directly on outbound row or fetched via join
        inReplyToMessageSid: outbound.inbound_message_id ?? null,
    });

    // Persist success
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        await markOutboundSent(c, outbound.id, sid);
        await c.query("COMMIT");
    } catch (e) {
        await c.query("ROLLBACK");
        throw e;
    } finally {
        c.release();
    }

    return { sid };
}
