import { NextResponse } from 'next/server';
import { PharmacyServiceError } from './errors';
import { Prisma } from '@prisma/client';

export function handleApiError(error: unknown) {
  if (error instanceof PharmacyServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Log server-side even for "handled" Prisma errors — the client only
    // gets error.message, which is sometimes too terse to diagnose from
    // (e.g. doesn't include the query or params that triggered it).
    console.error(`[Prisma ${error.code}]`, error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error('[Prisma validation]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // Anything else (raw query failures, unexpected exceptions, etc.) falls
  // through here — the client only ever sees the generic message below,
  // but the full error, including stack trace, is always logged
  // server-side so it's actually possible to diagnose from the terminal.
  console.error('[Unhandled API error]', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
