import bcrypt from 'bcryptjs';
import { query } from '../db';

async function resetPassword() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: npx tsx server/scripts/resetPassword.ts <email> <newPassword>');
    process.exit(1);
  }

  const email = args[0].trim().toLowerCase();
  const newPassword = args[1];

  if (newPassword.length < 6) {
    console.error('Error: Password must be at least 6 characters.');
    process.exit(1);
  }

  try {
    const users = await query<any[]>('SELECT id, email FROM users WHERE email = ? LIMIT 1', [email]);
    if (users.length === 0) {
      console.error(`User with email "${email}" not found.`);
      process.exit(1);
    }

    const user = users[0];
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

    console.log(`✅ Successfully updated password for ${user.email} (ID: ${user.id})`);
  } catch (err) {
    console.error('Failed to reset password:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

resetPassword();
