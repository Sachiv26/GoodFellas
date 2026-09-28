/**
 * Creates (or promotes) an admin user.
 *
 * Usage: node scripts/create-admin-user.js <email> <password> [role]
 * Role defaults to SUPER_ADMIN so the account can reach every admin surface.
 *
 * Upserts on the unique email, so re-running is safe and also promotes an
 * existing customer account to admin rather than failing on the unique index.
 */
// Run with: node --env-file=.env scripts/create-admin-user.js <email> <password> [role]
// The .env file is loaded by Node's built-in --env-file flag, because this
// project has no dotenv dependency (Next.js loads .env itself).
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12; // must match src/lib/auth/password.ts

async function main() {
  const [email, password, role = 'SUPER_ADMIN'] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Usage: node --env-file=.env scripts/create-admin-user.js <email> <password> [role]');
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    throw new Error(`Role must be ADMIN or SUPER_ADMIN, received: ${role}`);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: { passwordHash, role, isActive: true, emailVerifiedAt: new Date() },
    create: {
      email: normalizedEmail,
      firstName: 'Admin',
      surname: 'User',
      mobileNumber: '0000000000',
      passwordHash,
      role,
      emailVerifiedAt: new Date(),
    },
  });
  // Never print the hash back out.
  console.log(JSON.stringify({ id: user.id, email: user.email, role: user.role, isActive: user.isActive }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
