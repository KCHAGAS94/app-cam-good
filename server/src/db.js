import fs from 'node:fs/promises';
import pg from 'pg';
import {config} from './config.js';

export const pool = new pg.Pool({connectionString: config.databaseUrl, max: 10});

/** Creates/updates the tables (schema.sql is idempotent). */
export async function migrate() {
  const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

export const query = (text, params) => pool.query(text, params);

/** Records an action in access_log (never throws: logging must not break requests). */
export async function audit(req, action, {cameraId = null, detail = null, userId} = {}) {
  try {
    await pool.query(
      'INSERT INTO access_log (user_id, camera_id, action, detail, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        userId ?? req.user?.id ?? null,
        cameraId,
        action,
        detail ? JSON.stringify(detail) : null,
        req.ip,
        req.get('user-agent')?.slice(0, 300) ?? null,
      ],
    );
  } catch (e) {
    console.error('audit failed', e.message);
  }
}
