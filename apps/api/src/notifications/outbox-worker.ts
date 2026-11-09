import 'reflect-metadata';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import { decryptOutboxPayload } from './outbox-crypto';

const pool = new Pool({ connectionString: process.env.PROVISIONING_DATABASE_URL, max: 2, application_name: 'firecontrol360-outbox-worker' });
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
});
const intervalMs = Math.max(1000, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 5000));
const maxAttempts = Math.max(1, Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 8));

async function deliverOne(): Promise<boolean> {
  const client = await pool.connect();
  let row: any;
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `SELECT id, tenant_id, notification_type, recipient_email, payload_ciphertext, attempts
       FROM notification_outbox
       WHERE (status = 'PENDING' AND available_at <= now())
          OR (status = 'PROCESSING' AND locked_until < now())
       ORDER BY available_at, created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!claimed.rowCount) { await client.query('COMMIT'); return false; }
    row = claimed.rows[0];
    await client.query(
      `UPDATE notification_outbox
       SET status = 'PROCESSING', locked_until = now() + interval '2 minutes',
           attempts = attempts + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [row.id, row.tenant_id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    const payload = decryptOutboxPayload(row.payload_ciphertext) as { subject: string; text?: string; html?: string };
    if (!payload?.subject || (!payload.text && !payload.html)) throw new Error('Outbox email payload is incomplete');
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: row.recipient_email,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    await pool.query(
      `UPDATE notification_outbox SET status = 'SENT', sent_at = now(), locked_until = NULL,
       last_error = NULL, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
      [row.id, row.tenant_id],
    );
  } catch (error) {
    const attempts = Number(row.attempts) + 1;
    const terminal = attempts >= maxAttempts;
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
    await pool.query(
      `UPDATE notification_outbox SET status = $3, locked_until = NULL,
       available_at = CASE WHEN $3 = 'PENDING' THEN now() + ($4 * interval '1 second') ELSE available_at END,
       last_error = left($5, 1000), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
      [row.id, row.tenant_id, terminal ? 'FAILED' : 'PENDING', delaySeconds, error instanceof Error ? error.message : String(error)],
    );
  }
  return true;
}

async function run() {
  if (!process.env.PROVISIONING_DATABASE_URL || !process.env.OUTBOX_ENCRYPTION_KEY ||
      !process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error('PROVISIONING_DATABASE_URL, OUTBOX_ENCRYPTION_KEY, SMTP_HOST and SMTP_FROM are required');
  }
  console.log('FireControl 360 outbox worker started');
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  while (!stopping) {
    try {
      const processed = await deliverOne();
      if (!processed) await new Promise(resolve => setTimeout(resolve, intervalMs));
    } catch (error) {
      console.error('Outbox polling failed:', error instanceof Error ? error.message : String(error));
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  await pool.end();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
