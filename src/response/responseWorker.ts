// src/response/responseWorker.ts
import "dotenv/config";
import { pool } from "../db/pool.js";
import { CONFIG } from "./config.js";
import { claimOutbound, markOutboundFailedOrDeadletter } from "./repo.js";
import { computeSendBackoffSeconds, sleep, truncate } from "./utils.js";
import { processOutbound } from "./processor.js";

let stopping = false;
process.on("SIGINT", () => { console.log(`[${CONFIG.WORKER_ID}] SIGINT received, stopping...`); stopping = true; });
process.on("SIGTERM", () => { console.log(`[${CONFIG.WORKER_ID}] SIGTERM received, stopping...`); stopping = true; });

async function run() {
    console.log(
        `[${CONFIG.WORKER_ID}] response-worker starting. poll=${CONFIG.POLL_MS}ms staleLock=${CONFIG.STALE_LOCK_SECONDS}s`
    );

    const r = await pool.query("select now() as now");
    console.log(`[${CONFIG.WORKER_ID}] DB OK at`, r.rows[0].now);

    while (!stopping) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const outbound = await claimOutbound(client, {
                staleLockSeconds: CONFIG.STALE_LOCK_SECONDS,
                workerId: CONFIG.WORKER_ID,
            });
            await client.query("COMMIT");

            if (!outbound) {
                await sleep(CONFIG.POLL_MS);
                continue;
            }

            console.log(
                `[${CONFIG.WORKER_ID}] Claimed outbound=${outbound.id} to=${outbound.to_address} attempts=${outbound.attempts}/${outbound.max_attempts}`
            );

            try {
                const { sid } = await processOutbound(outbound, (s) => console.log(`[${CONFIG.WORKER_ID}] ${s}`));
                console.log(`[${CONFIG.WORKER_ID}] Sent outbound ${outbound.id} -> Twilio SID ${sid}`);
            } catch (err: any) {
                const msg = err?.stack || err?.message || String(err);
                console.warn(`[${CONFIG.WORKER_ID}] Outbound ${outbound.id} failed: ${truncate(msg, 800)}`);

                const attemptsAfter = outbound.attempts + 1;
                const isDead = attemptsAfter >= outbound.max_attempts;
                const delaySeconds = isDead ? 0 : computeSendBackoffSeconds(attemptsAfter);

                const cFail = await pool.connect();
                try {
                    await cFail.query("BEGIN");
                    await markOutboundFailedOrDeadletter(cFail, {
                        outbound,
                        attemptsAfter,
                        isDead,
                        delaySeconds,
                        lastError: truncate(msg, 2000),
                    });
                    await cFail.query("COMMIT");
                } catch (e: any) {
                    await cFail.query("ROLLBACK");
                    console.error(
                        `[${CONFIG.WORKER_ID}] Failed to mark outbound ${outbound.id} failed/deadletter:`,
                        e?.stack || e
                    );
                } finally {
                    cFail.release();
                }
            }
        } catch (err: any) {
            try { await client.query("ROLLBACK"); } catch { }
            console.error(`[${CONFIG.WORKER_ID}] Loop error:`, err?.stack || err);
            await sleep(Math.min(2000, CONFIG.POLL_MS));
        } finally {
            client.release();
        }
    }

    console.log(`[${CONFIG.WORKER_ID}] stopping; draining pool...`);
    await pool.end();
    console.log(`[${CONFIG.WORKER_ID}] exited cleanly.`);
}

run().catch((e) => {
    console.error(`[${CONFIG.WORKER_ID}] fatal error:`, e?.stack || e);
    process.exit(1);
});
