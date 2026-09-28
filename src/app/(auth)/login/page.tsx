import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import LoginForm from './LoginForm';

/**
 * Server wrapper for the sign-in page.
 *
 * This redirect used to live in `src/middleware.ts`, which only verifies the JWT
 * signature and cannot see the database. A cookie whose account no longer
 * existed therefore still looked valid to the middleware, which bounced it away
 * from /login; the Server Component behind the dashboard then rejected that
 * same cookie and sent it back, looping until the browser gave up with
 * ERR_TOO_MANY_REDIRECTS.
 *
 * Checking the account here, against the database, means a genuinely valid
 * session still skips the form, while a stale cookie renders the form so
 * signing in can replace it.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getSessionUser();
  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { isActive: true },
    });
    if (user?.isActive) {
      const dest =
        session.role === 'ADMIN' || session.role === 'SUPER_ADMIN' ? '/admin' : '/dashboard';
      redirect(dest);
    }
  }
  return <LoginForm />;
}
