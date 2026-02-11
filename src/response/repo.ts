// src/response/repo.ts
import type { PoolClient } from "pg";
import type { OutboundRow } from "./types.js";

export async function claimOutbound(client: PoolClient, args: {
  staleLockSeconds: number;
  workerId: string;
}): Promise<OutboundRow | null> {
  const q = `
    WITH candidate AS (
      SELECT id
      FROM outbound_messages
      WHERE
        (
          status IN ('pending','failed')
          AND send_after <= now()
        )
        OR
        (
          status = 'sending'
          AND locked_at IS NOT NULL
          AND locked_at < now() - ($1::int * interval '1 second')
        )
      ORDER BY send_after ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE outbound_messages m
    SET
      status = 'sending',
      locked_at = now(),
      locked_by = $2,
      updated_at = now()
    FROM candidate
    WHERE m.id = candidate.id
    RETURNING
      m.id, m.conversation_id, m.inbound_message_id, m.reply_job_id,
      m.provider, m.to_address, m.from_address, m.body,
      m.status, m.attempts, m.max_attempts, m.send_after,
      m.locked_at, m.locked_by, m.provider_outbound_sid, m.last_error, m.provider_inbound_sid,
      m.sequence_number
  `;
  const res = await client.query<OutboundRow>(q, [args.staleLockSeconds, args.workerId]);
  return res.rows[0] ?? null;
}

export async function claimOutboundBatch(client: PoolClient, args: {
  staleLockSeconds: number;
  workerId: string;
}): Promise<OutboundRow[]> {
  const q = `
    WITH target_address AS (
      SELECT to_address
      FROM outbound_messages
      WHERE
        (
          status IN ('pending','failed')
          AND send_after <= now()
        )
        OR
        (
          status = 'sending'
          AND locked_at IS NOT NULL
          AND locked_at < now() - ($1::int * interval '1 second')
        )
      ORDER BY send_after ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ),
    candidates AS (
      SELECT id
      FROM outbound_messages
      WHERE to_address = (SELECT to_address FROM target_address)
        AND (
          (status IN ('pending','failed') AND send_after <= now())
          OR (status = 'sending' AND locked_at IS NOT NULL
              AND locked_at < now() - ($1::int * interval '1 second'))
        )
      ORDER BY sequence_number ASC
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbound_messages m
    SET
      status = 'sending',
      locked_at = now(),
      locked_by = $2,
      updated_at = now()
    FROM candidates
    WHERE m.id = candidates.id
    RETURNING
      m.id, m.conversation_id, m.inbound_message_id, m.reply_job_id,
      m.provider, m.to_address, m.from_address, m.body,
      m.status, m.attempts, m.max_attempts, m.send_after,
      m.locked_at, m.locked_by, m.provider_outbound_sid, m.last_error, m.provider_inbound_sid,
      m.sequence_number
  `;
  const res = await client.query<OutboundRow>(q, [args.staleLockSeconds, args.workerId]);
  return res.rows.sort((a, b) => a.sequence_number - b.sequence_number);
}

export async function releaseOutbound(client: PoolClient, ids: string[]) {
  if (ids.length === 0) return;
  await client.query(
    `
    UPDATE outbound_messages
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE id = ANY($1)
    `,
    [ids]
  );
}

export async function markOutboundSent(client: PoolClient, outboundId: string, sid: string) {
  await client.query(
    `
    UPDATE outbound_messages
    SET
      status='sent',
      provider_outbound_sid=$2,
      locked_at=NULL,
      locked_by=NULL,
      last_error=NULL,
      updated_at=now()
    WHERE id=$1
    `,
    [outboundId, sid]
  );
}

export async function markOutboundFailedOrDeadletter(client: PoolClient, args: {
  outbound: OutboundRow;
  attemptsAfter: number;
  isDead: boolean;
  delaySeconds: number;
  lastError: string;
}) {
  await client.query(
    `
    UPDATE outbound_messages
    SET
      attempts = $2,
      status = CASE WHEN $3 THEN 'deadletter' ELSE 'failed' END,
      send_after = CASE
        WHEN $3 THEN send_after
        ELSE now() + make_interval(secs => $4)
      END,
      last_error = $5,
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE id = $1
    `,
    [args.outbound.id, args.attemptsAfter, args.isDead, args.delaySeconds, args.lastError]
  );
}
