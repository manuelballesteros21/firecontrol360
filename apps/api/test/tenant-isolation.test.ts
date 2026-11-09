import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

const required = ['DATABASE_URL','TENANT_A_ID','TENANT_B_ID','EQUIPMENT_B_ID'];
const missing = required.filter(key => !process.env[key]);
const enabled = missing.length === 0;
const pool = enabled ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;

test('RLS isolates tenant A from tenant B equipment', { skip: enabled ? false : `Set ${missing.join(', ')} for integration test` }, async () => {
  const client = await pool!.connect();
  try {
    const role = await client.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
    assert.equal(role.rows[0]?.rolbypassrls, false, 'runtime database role must not have BYPASSRLS');
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [process.env.TENANT_B_ID]);
    const fixture = await client.query('SELECT id FROM equipment WHERE id = $1', [process.env.EQUIPMENT_B_ID]);
    assert.equal(fixture.rowCount, 1, 'test fixture must belong to tenant B and be visible in its own tenant context');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [process.env.TENANT_A_ID]);
    const read = await client.query('SELECT id FROM equipment WHERE id = $1', [process.env.EQUIPMENT_B_ID]);
    assert.equal(read.rowCount, 0, 'tenant A must not read tenant B equipment');
    const update = await client.query("UPDATE equipment SET asset_code = asset_code WHERE id = $1 RETURNING id", [process.env.EQUIPMENT_B_ID]);
    assert.equal(update.rowCount, 0, 'tenant A must not update tenant B equipment');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

test('RLS context is transaction-local and does not leak through pooled connections', { skip: enabled ? false : `Set ${missing.join(', ')} for integration test` }, async () => {
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [process.env.TENANT_A_ID]);
    const current = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant_id");
    assert.equal(current.rows[0].tenant_id, process.env.TENANT_A_ID);
    await client.query('ROLLBACK');
    const reset = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant_id");
    assert.notEqual(reset.rows[0].tenant_id, process.env.TENANT_A_ID, 'tenant context must reset after transaction');
  } finally { client.release(); }
});

test.after(async () => { await pool?.end(); });
