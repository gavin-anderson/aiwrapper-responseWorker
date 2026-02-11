// src/response/responseWorker.ts
import "dotenv/config";
import { pool } from "../db/pool.js";
import { CONFIG } from "./config.js";
import { claimOutboundBatch, markOutboundFailedOrDeadletter, releaseOutbound } from "./repo.js";
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
        let batch: import("./types.js").OutboundRow[] = [];
        try {
            await client.query("BEGIN");
            batch = await claimOutboundBatch(client, {
                staleLockSeconds: CONFIG.STALE_LOCK_SECONDS,
                workerId: CONFIG.WORKER_ID,
            });
            await client.query("COMMIT");

            if (batch.length === 0) {
                await sleep(CONFIG.POLL_MS);
                continue;
            }

            console.log(
                `[${CONFIG.WORKER_ID}] Claimed batch of ${batch.length} message(s) to=${batch[0].to_address}`
            );

            for (let i = 0; i < batch.length; i++) {
                const outbound = batch[i];
                if (stopping) break;

                console.log(
                    `[${CONFIG.WORKER_ID}] Processing outbound=${outbound.id} seq=${outbound.sequence_number} attempts=${outbound.attempts}/${outbound.max_attempts}`
                );

                try {
                    const { sid } = await processOutbound(outbound, (s) => console.log(`[${CONFIG.WORKER_ID}] ${s}`));
                    console.log(`[${CONFIG.WORKER_ID}] Sent outbound ${outbound.id} -> SID ${sid}`);
                } catch (err: any) {
                    const msg = err?.stack || err?.message || String(err);
                    console.warn(`[${CONFIG.WORKER_ID}] Outbound ${outbound.id} failed: ${truncate(msg, 800)}`);

                    const attemptsAfter = outbound.attempts + 1;
                    const isDead = attemptsAfter >= outbound.max_attempts;
                    const delaySeconds = isDead ? 0 : computeSendBackoffSeconds(attemptsAfter);

                    // Release remaining messages in the batch back to pending
                    const remainingIds = batch.slice(i + 1).map((m) => m.id);

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
                        await releaseOutbound(cFail, remainingIds);
                        await cFail.query("COMMIT");

                        if (remainingIds.length > 0) {
                            console.log(
                                `[${CONFIG.WORKER_ID}] Released ${remainingIds.length} remaining message(s) back to pending`
                            );
                        }
                    } catch (e: any) {
                        await cFail.query("ROLLBACK");
                        console.error(
                            `[${CONFIG.WORKER_ID}] Failed to mark outbound ${outbound.id} failed/deadletter:`,
                            e?.stack || e
                        );
                    } finally {
                        cFail.release();
                    }

                    break; // Stop processing this batch
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
