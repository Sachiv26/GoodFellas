/**
 * Drains pending document-processing jobs.
 *
 * The upload route kicks processing off in the background and does not wait for
 * it, so a serverless runtime can freeze or discard that work the moment the
 * response is sent. This endpoint is the durable safety net: anything still
 * PENDING is processed here instead.
 *
 * Configure it as a Vercel cron (`vercel.json`) or call it from any scheduler.
 * It is protected by `CRON_SECRET` (Vercel sends this automatically as a Bearer
 * token); when that variable is unset the endpoint refuses to run, so it can
 * never be triggered anonymously.
 */
import { NextResponse } from 'next/server';
import { drainPendingJobs } from '@/server/services/document-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 503 }
    );
  }

  const authorization = request.headers.get('authorization');
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainPendingJobs(20);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      '[cron] drain failed:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: 'Drain failed' }, { status: 500 });
  }
}
