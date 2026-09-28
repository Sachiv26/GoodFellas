/**
 * Session lifetime helpers (pure — no Next.js or crypto imports so they can be
 * unit tested and reused by both the cookie writer and the token signer).
 *
 * `JWT_EXPIRES_IN` accepts the same formats jose does: "7d", "12h", "30m",
 * "45s" or a plain number of seconds. The httpOnly cookie MUST expire with the
 * token, otherwise the browser keeps presenting a token that is already dead
 * (or drops a cookie while the token is still valid).
 */

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7,
};

/** Parse "7d" / "12h" / "30m" / 3600 into seconds. Returns null when invalid. */
export function durationToSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+)\s*([smhdw])?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = UNIT_SECONDS[unit];
  if (!multiplier || !Number.isFinite(amount) || amount <= 0) return null;
  return amount * multiplier;
}

/**
 * Cookie maxAge (seconds) derived from the configured token lifetime.
 * Falls back to the documented 7-day default when misconfigured.
 */
export function sessionCookieMaxAge(expiresIn: string | number | undefined): number {
  return durationToSeconds(expiresIn) ?? UNIT_SECONDS.d * 7;
}
