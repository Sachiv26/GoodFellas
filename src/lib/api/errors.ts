/**
 * Central API error handler for route handlers.
 * Converts thrown errors into safe JSON responses without leaking internals.
 *
 * Two call styles:
 *   apiError(error)                  — map a thrown HttpError/ZodError
 *   apiError(code, message, status)  — explicit coded response
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from '@/lib/auth/session';

export function apiError(error: unknown): NextResponse;
export function apiError(code: string, message: string, status: number, details?: unknown): NextResponse;
export function apiError(
  errorOrCode: unknown,
  message?: string,
  status?: number,
  details?: unknown
): NextResponse {
  if (typeof errorOrCode === 'string') {
    const body: Record<string, unknown> = { error: message ?? 'Request failed', code: errorOrCode };
    if (details !== undefined) body.details = details;
    return NextResponse.json(body, { status: status ?? 400 });
  }
  const error = errorOrCode;
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      },
      { status: 400 }
    );
  }
  console.error('[api] unhandled error:', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

