import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { toUserDto } from '@/types/dto';
import { db } from '@/lib/db';

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user || !user.isActive) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({ user: toUserDto(user) });
}
