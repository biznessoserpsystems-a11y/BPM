import { authFetch } from '@/lib/store';

/**
 * Fetches and parses JSON, but throws on a non-2xx response instead of
 * silently returning the error body as if it were data. Without this, a
 * failed request (401, 500, etc.) becomes `{ error: "..." }` assigned
 * straight to a query's `data`, and any code expecting an array or object
 * shape (`.map()`, `.find()`, property access) crashes the component
 * instead of failing gracefully through react-query's `isError` state.
 *
 * Works for both queries and mutations — pass `init` (method, headers,
 * body) for POST/PATCH calls. On failure, the thrown Error's `.message`
 * is the backend's actual validation message (e.g. "Insufficient stock
 * in batch X") rather than a generic "Failed to X" string, so mutation
 * onError handlers can show the user what actually went wrong.
 *
 * Use as a useQuery queryFn: `queryFn: () => fetchJson<Thing[]>('/api/v1/things')`
 * Use as a mutationFn: `mutationFn: (body) => fetchJson('/api/v1/things', { method: 'POST', headers: {...}, body: JSON.stringify(body) })`
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error) || `Request to ${url} failed (${res.status})`);
  }
  return body as T;
}
