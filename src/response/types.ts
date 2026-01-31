// src/response/types.ts
export type OutboundStatus = "pending" | "sending" | "sent" | "failed" | "deadletter";

export type OutboundRow = {
    id: string;
    conversation_id: string;
    inbound_message_id: string;
    reply_job_id: string;

    provider: string;
    to_address: string;
    from_address: string;
    body: string;

    status: OutboundStatus;
    attempts: number;
    max_attempts: number;
    send_after: string;

    locked_at: string | null;
    locked_by: string | null;

    provider_outbound_sid: string | null;
    last_error: string | null;
    provider_inbound_sid: string | null;
};
