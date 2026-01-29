// src/db/pool.ts
import { Pool } from "pg";
import { requiredEnv } from "../response/config.js";

export const pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    // If you needed this with Supabase pooler locally:
    // ssl: { rejectUnauthorized: false },
});
