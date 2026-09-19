import { NextRequest } from 'next/server';

/**
 * Builds a NextRequest the way route handlers expect it — Next.js route
 * handlers (route.ts's exported GET/POST/PATCH functions) are plain async
 * functions that take a (NextRequest, { params }) pair, so they can be
 * called directly in a test without spinning up an actual HTTP server.
 * This is the standard way to smoke-test Next.js App Router API routes.
 */
export function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');

  return new NextRequest(new URL(url, 'http://localhost'), {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** For [id]/route.ts-style handlers whose second argument is `{ params: Promise<{...}> }`. */
export function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

/** Small helper so assertions read as `expect(await jsonOf(response)).toMatchObject(...)`. */
export async function jsonOf(response: Response): Promise<any> {
  return response.json();
}
