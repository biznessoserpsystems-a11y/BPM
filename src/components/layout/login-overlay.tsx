'use client';

import { useState, useEffect } from 'react';
import { usePharmacyStore, type AuthUser } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Boxes, ShieldCheck, ScrollText, Building2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';

export function LoginOverlay() {
  const { login, isLoggingIn } = usePharmacyStore();
  const [mode, setMode] = useState<'signin' | 'register' | 'reactivate'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Username and password are required');
      return;
    }

    try {
      await login(username, password);
      toast.success('Welcome back!');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'TRIAL_EXPIRED') {
        setMode('reactivate');
        return;
      }
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-background">
      {/* Brand panel — the app's one hero moment */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[38%] flex-col justify-between bg-sidebar text-sidebar-foreground p-12 relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(circle, oklch(0.72 0.14 75) 0%, transparent 70%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white overflow-hidden flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, no benefit from next/image here */}
              <img src="/brand/logo-icon.png" alt="Bizness Shop-OS" className="h-full w-full object-contain p-0.5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Bizness Shop-OS</span>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="font-display text-4xl xl:text-5xl font-medium leading-[1.1] text-sidebar-foreground">
            The ledger for<br />every branch,<br />every batch.
          </h1>
          <p className="text-sm text-sidebar-foreground/60 max-w-xs leading-relaxed">
            FEFO-tracked inventory, multi-branch transfers, and a full IFRS
            general ledger — kept as precisely as the medicine itself.
          </p>
        </div>

        <div className="relative space-y-3">
          <div className="flex items-center gap-3 text-sidebar-foreground/70 text-xs">
            <Boxes className="h-4 w-4 text-amber-400 flex-shrink-0" />
            First-expired-first-out batch picking, by design
          </div>
          <div className="flex items-center gap-3 text-sidebar-foreground/70 text-xs">
            <ScrollText className="h-4 w-4 text-amber-400 flex-shrink-0" />
            Every sale, transfer, and adjustment, audited
          </div>
          <div className="flex items-center gap-3 text-sidebar-foreground/70 text-xs">
            <ShieldCheck className="h-4 w-4 text-amber-400 flex-shrink-0" />
            IFRS-compliant accounting, built in
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-sm py-8">
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white border overflow-hidden flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, no benefit from next/image here */}
              <img src="/brand/logo-icon.png" alt="Bizness Shop-OS" className="h-full w-full object-contain p-0.5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Bizness Shop-OS</span>
          </div>

          {mode === 'signin' ? (
            <>
              <div className="mb-8">
                <h2 className="font-display text-2xl font-medium text-foreground">Sign in</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter your credentials to continue</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    disabled={isLoggingIn}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoggingIn}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-brand-600 hover:bg-brand-700"
                  disabled={isLoggingIn}
                  loading={isLoggingIn}
                >
                  {isLoggingIn ? 'Signing in...' : 'Sign In'}
                </Button>

                <p className="text-center text-sm text-muted-foreground pt-2">
                  New pharmacy?{' '}
                  <button type="button" onClick={() => setMode('register')} className="text-brand-600 hover:text-brand-700 font-medium">
                    Create a company
                  </button>
                </p>
              </form>
            </>
          ) : mode === 'register' ? (
            <RegisterCompanyForm onBackToSignIn={() => setMode('signin')} />
          ) : (
            <ReactivateForm username={username} onBackToSignIn={() => setMode('signin')} />
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPANY REGISTRATION
// =============================================================================

function RegisterCompanyForm({ onBackToSignIn }: { onBackToSignIn: () => void }) {
  const { setSession } = usePharmacyStore();
  const [form, setForm] = useState({
    companyName: '', companyCode: '', adminFullName: '', adminUsername: '', adminEmail: '', adminPassword: '', licenseToken: '',
  });
  const [logoPreview, setLogoPreview] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tokenCheck, setTokenCheck] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid'; message?: string; remaining?: number }>({ status: 'idle' });

  // Debounced — checks 500ms after typing stops, not on every keystroke,
  // so a normal-speed typist doesn't fire a request per character.
  useEffect(() => {
    const token = form.licenseToken.trim();
    if (!token) {
      setTokenCheck({ status: 'idle' });
      return;
    }
    setTokenCheck({ status: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await fetchJson<{ valid: boolean; remaining: number; message?: string }>('/api/v1/auth/validate-license-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        setTokenCheck({ status: result.valid ? 'valid' : 'invalid', message: result.message, remaining: result.remaining });
      } catch {
        setTokenCheck({ status: 'invalid', message: 'Could not check this token — try again' });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.licenseToken]);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Explicit allowlist, not a broad "image/*" check — see
    // src/lib/logo-validation.ts for why (deliberately excludes SVG,
    // which can embed scripts). This is defense-in-depth; the real
    // enforcement is the same check applied server-side.
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(file.type)) {
      toast.error('Please choose a PNG, JPEG, GIF, or WebP image');
      return;
    }
    if (file.size > 400_000) {
      toast.error('Image is too large — please use one under 400KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.companyName || !form.companyCode || !form.adminFullName || !form.adminUsername || !form.adminPassword || !form.licenseToken) {
      setError('All fields except email and logo are required, including a valid license token');
      return;
    }
    if (tokenCheck.status !== 'valid') {
      setError('Enter a valid license token before continuing');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await fetchJson<{ token: string; user: AuthUser }>('/api/v1/auth/register-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, logoUrl: logoPreview || undefined }),
      });
      setSession(data.token, data.user);
      toast.success(`${form.companyName} is set up! You're signed in as its first Admin.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-medium text-foreground flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-600" /> Create a company
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Sets up a new, separate company with its own branch and admin account.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="licenseToken">License Token</Label>
          <Input
            id="licenseToken"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono tracking-wide"
            value={form.licenseToken}
            onChange={(e) => setForm((f) => ({ ...f, licenseToken: e.target.value.toUpperCase() }))}
            disabled={isSubmitting}
            autoFocus
          />
          {tokenCheck.status === 'checking' && (
            <p className="text-[10px] text-muted-foreground">Checking...</p>
          )}
          {tokenCheck.status === 'valid' && (
            <p className="text-[10px] text-brand-700">
              Valid — {tokenCheck.remaining} compan{tokenCheck.remaining === 1 ? 'y' : 'ies'} remaining on this token.
            </p>
          )}
          {tokenCheck.status === 'invalid' && (
            <p className="text-[10px] text-rose-600">{tokenCheck.message}</p>
          )}
          {tokenCheck.status === 'idle' && (
            <p className="text-[10px] text-muted-foreground">Given to you when you purchased this software.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="companyName">Company Name</Label>
          <Input id="companyName" placeholder="Acme Pharmacy" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} disabled={isSubmitting} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="companyCode">Company Code</Label>
          <Input id="companyCode" placeholder="acme-pharma" value={form.companyCode} onChange={(e) => setForm((f) => ({ ...f, companyCode: e.target.value.toLowerCase() }))} disabled={isSubmitting} />
          <p className="text-[10px] text-muted-foreground">Lowercase letters, numbers, and hyphens only — used as your first branch&apos;s code.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Logo (optional)</Label>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/30 overflow-hidden flex-shrink-0">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- previewing a data URI, not a static asset
                <img src={logoPreview} alt="Logo preview" className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-5 w-5 text-muted-foreground/40" />
              )}
            </div>
            <label className="text-xs text-brand-600 hover:text-brand-700 font-medium cursor-pointer">
              {logoPreview ? 'Change' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} disabled={isSubmitting} />
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adminFullName">Your Full Name</Label>
          <Input id="adminFullName" placeholder="Jane Mensah" value={form.adminFullName} onChange={(e) => setForm((f) => ({ ...f, adminFullName: e.target.value }))} disabled={isSubmitting} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="adminUsername">Username</Label>
            <Input id="adminUsername" value={form.adminUsername} onChange={(e) => setForm((f) => ({ ...f, adminUsername: e.target.value }))} disabled={isSubmitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">Email (optional)</Label>
            <Input id="adminEmail" type="email" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} disabled={isSubmitting} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adminPassword">Password</Label>
          <PasswordInput id="adminPassword" value={form.adminPassword} onChange={(v) => setForm((f) => ({ ...f, adminPassword: v }))} autoComplete="new-password" />
          <p className="text-[10px] text-muted-foreground">At least 8 characters, with uppercase, lowercase, and a number.</p>
        </div>

        <div className="rounded-md bg-brand-50 border border-brand-200 px-3 py-2 text-xs text-brand-800">
          Your company gets its own branch, staff accounts, product catalog, and Chart of Accounts — fully
          separate from any other company here, with a starter set of accounts already set up. An Admin can
          edit or extend that from Settings after signing in.
        </div>

        <Button type="submit" className="w-full bg-brand-600 hover:bg-brand-700" disabled={isSubmitting || tokenCheck.status !== 'valid'} loading={isSubmitting}>
          {isSubmitting ? 'Setting up...' : 'Create Company & Sign In'}
        </Button>

        <p className="text-center text-sm text-muted-foreground pt-1">
          Already have an account?{' '}
          <button type="button" onClick={onBackToSignIn} className="text-brand-600 hover:text-brand-700 font-medium">
            Sign in
          </button>
        </p>
      </form>
    </>
  );
}

// =============================================================================
// TRIAL REACTIVATION
// =============================================================================

function ReactivateForm({ username: initialUsername, onBackToSignIn }: { username: string; onBackToSignIn: () => void }) {
  const { setSession } = usePharmacyStore();
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [requestedInfo, setRequestedInfo] = useState<{ code: string; companyName: string; note: string } | null>(null);
  const [error, setError] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username) {
      setError('Enter your username');
      return;
    }
    setIsRequesting(true);
    try {
      const data = await fetchJson<{ code: string; companyName: string; note: string }>('/api/v1/auth/request-reactivation-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      setRequestedInfo(data);
      setCode(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request a code');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleReactivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!code) {
      setError('Enter the reactivation code');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }
    setIsReactivating(true);
    try {
      const data = await fetchJson<{ token: string; user: AuthUser }>('/api/v1/auth/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code, password }),
      });
      setSession(data.token, data.user);
      toast.success('Reactivated! Your trial now runs for another 30 days.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reactivation failed');
    } finally {
      setIsReactivating(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-medium text-foreground flex items-center gap-2">
          <RotateCw className="h-5 w-5 text-amber-600" /> Trial expired
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {requestedInfo ? `Enter the code to reactivate ${requestedInfo.companyName}.` : 'Request a code to reactivate your company for another 30 days.'}
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 mb-4">
          {error}
        </div>
      )}

      {!requestedInfo ? (
        <form onSubmit={handleRequestCode} className="space-y-3">
          <div>
            <Label htmlFor="reactivate-username">Username</Label>
            <Input id="reactivate-username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isRequesting} autoFocus />
          </div>
          <Button type="submit" className="w-full bg-brand-600 hover:bg-brand-700" disabled={isRequesting} loading={isRequesting}>
            {isRequesting ? 'Requesting...' : 'Request Reactivation Code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleReactivate} className="space-y-3">
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            {requestedInfo.note}
          </div>
          <div>
            <Label className="text-xs">Your reactivation code</Label>
            <div className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-lg tracking-widest text-center select-all">
              {requestedInfo.code}
            </div>
          </div>
          <div>
            <Label htmlFor="reactivate-code">Enter code to confirm</Label>
            <Input id="reactivate-code" className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={isReactivating} autoFocus />
          </div>
          <div>
            <Label htmlFor="reactivate-password">Password</Label>
            <Input id="reactivate-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isReactivating} placeholder="Confirm it's really you" />
          </div>
          <Button type="submit" className="w-full bg-brand-600 hover:bg-brand-700" disabled={isReactivating} loading={isReactivating}>
            {isReactivating ? 'Reactivating...' : 'Reactivate & Sign In'}
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground pt-4">
        <button type="button" onClick={onBackToSignIn} className="text-brand-600 hover:text-brand-700 font-medium">
          Back to sign in
        </button>
      </p>
    </>
  );
}
