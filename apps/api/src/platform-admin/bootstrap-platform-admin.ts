import 'reflect-metadata';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

async function main() {
  const connectionString = process.env.PROVISIONING_DATABASE_URL;
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.PLATFORM_ADMIN_NAME?.trim();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!connectionString || !email || !fullName || !password || password.length < 16) {
    throw new Error('Set PROVISIONING_DATABASE_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD (minimum 16 characters).');
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const result = await pool.query(
      `INSERT INTO platform_admins (email, full_name, password_hash)
       VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, fullName, passwordHash],
    );
    if (result.rowCount !== 1) throw new Error('Platform administrator already exists; bootstrap did not overwrite it.');
    process.stdout.write(`Created platform administrator ${email} (id ${result.rows[0].id}).\n`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
