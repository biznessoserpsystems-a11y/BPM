'use client';

import { useState } from 'react';

type LicenseToken = {
  id: string;
  token: string;
  label: string | null;
  maxCompanies: number;
  companiesCreated: number;
  isActive: boolean;
  createdAt: string;
};

export default function LicenseAdminPage() {
  // The admin secret lives in React state only — never written to
  // storage, and gone when the tab is closed or refreshed.
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [maxCompanies, setMaxCompanies] = useState(2);
  const [tokens, setTokens] = useState<LicenseToken[]>([]);
  const [latest, setLatest] = useState<LicenseToken | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const headers = { 'Content-Type': 'application/json', 'x-admin-secret': secret };

  async function loadTokens() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/license-tokens', { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load tokens.');
      setTokens(data.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tokens.');
    } finally {
      setBusy(false);
    }
  }

  async function createToken() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/license-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({ label, maxCompanies }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create token.');
      setLatest(data.token);
      setTokens((prev) => [data.token, ...prev]);
      setLabel('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create token.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Copy failed. Select the token and copy it manually.');
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-emerald-700">License tokens</h1>
        <p className="mt-1 text-sm text-gray-600">
          Create tokens that customers enter on the Create a company screen.
        </p>
      </header>

      <section className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="secret">
          Admin secret
        </label>
        <div className="flex gap-2">
          <input
            id="secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="flex-1 rounded border px-3 py-2"
            placeholder="LICENSE_ADMIN_SECRET from the server .env"
          />
          <button
            onClick={loadTokens}
            disabled={!secret || busy}
            className="rounded border border-emerald-600 px-4 py-2 text-emerald-700 disabled:opacity-50"
          >
            Load tokens
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="font-medium">New token</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <div>
            <label className="block text-sm" htmlFor="label">
              Customer or label (optional)
            </label>
            <input
              id="label"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="e.g. Acme Pharmacy Group"
            />
          </div>
          <div>
            <label className="block text-sm" htmlFor="max">
              Companies allowed
            </label>
            <input
              id="max"
              type="number"
              min={1}
              max={1000}
              value={maxCompanies}
              onChange={(e) => setMaxCompanies(Number(e.target.value))}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
        </div>
        <button
          onClick={createToken}
          disabled={!secret || busy}
          className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        >
          Generate token
        </button>

        {latest && (
          <div className="rounded bg-emerald-50 p-3">
            <p className="text-sm text-gray-600">Token created. Give this to the customer:</p>
            <div className="mt-1 flex items-center gap-3">
              <code className="text-lg font-semibold tracking-wider">{latest.token}</code>
              <button onClick={() => copy(latest.token)} className="text-sm text-emerald-700 underline">
                {copied === latest.token ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-medium">Existing tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-gray-600">
            No tokens loaded. Enter the admin secret and select Load tokens.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">Token</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Companies used</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 pr-4 font-mono">{t.token}</td>
                    <td className="py-2 pr-4">{t.label ?? ''}</td>
                    <td className="py-2 pr-4">
                      {t.companiesCreated} of {t.maxCompanies}
                    </td>
                    <td className="py-2 pr-4">{t.isActive ? 'Active' : 'Deactivated'}</td>
                    <td className="py-2">
                      <button onClick={() => copy(t.token)} className="text-emerald-700 underline">
                        {copied === t.token ? 'Copied' : 'Copy'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
