import { create } from 'zustand';
import { toast } from 'sonner';

export interface PosCartItem {
  batchId: string;
  productId: number;
  brandName: string;
  genericName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  availableQty: number;
}

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email?: string;
  roleName: string;
  companyId: string;
  homeBranchId: string;
  licenseNumber?: string;
  isActive: boolean;
  role: { roleName: string; description?: string };
}

interface PharmacyStore {
  // Auth
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => void;
  restoreSession: () => void;

  // Navigation
  activeView: string;
  selectedBranchId: string;
  pendingTab: string | null;
  setView: (view: string, tab?: string) => void;
  setBranch: (branchId: string) => void;
  consumePendingTab: () => string | null;

  // POS Cart
  posCart: PosCartItem[];
  addToCart: (item: PosCartItem) => void;
  removeFromCart: (batchId: string) => void;
  updateCartQty: (batchId: string, qty: number) => void;
  clearCart: () => void;
}

export const usePharmacyStore = create<PharmacyStore>((set, get) => ({
  // Auth state
  token: null,
  user: null,
  isAuthenticated: false,
  isLoggingIn: false,

  login: async (username: string, password: string) => {
    set({ isLoggingIn: true });
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || 'Login failed') as Error & { code?: string };
        err.code = data.code;
        throw err;
      }

      get().setSession(data.token, data.user);
      set({ isLoggingIn: false });
    } catch (error) {
      set({ isLoggingIn: false });
      throw error;
    }
  },

  // Shared by login() above and by company registration (which returns a
  // token directly from POST /auth/register-company, same shape as
  // /auth/login) — establishing a session is the same three steps either
  // way: persist to localStorage, set auth state, default the branch
  // selector to wherever this user actually works.
  setSession: (token: string, user: AuthUser) => {
    localStorage.setItem('pharma_token', token);
    localStorage.setItem('pharma_user', JSON.stringify(user));
    set({
      token,
      user,
      isAuthenticated: true,
      selectedBranchId: user.homeBranchId,
    });
  },

  logout: () => {
    localStorage.removeItem('pharma_token');
    localStorage.removeItem('pharma_user');
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      posCart: [],
      activeView: 'dashboard',
    });
  },

  restoreSession: () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('pharma_token');
    const userStr = localStorage.getItem('pharma_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        // Self-heal sessions cached before the login response started
        // including a flat roleName (see /api/v1/auth/login) — without
        // this, anyone already signed in when that fix ships would stay
        // on the old, incomplete cached user object until they happened
        // to log out and back in.
        if (!user.roleName && user.role?.roleName) {
          user.roleName = user.role.roleName;
          localStorage.setItem('pharma_user', JSON.stringify(user));
        }
        set({
          token,
          user,
          isAuthenticated: true,
          selectedBranchId: user.homeBranchId || '',
        });

        // The token in storage may have expired since the last visit (it's
        // only valid for 12h). Verify it against the server right away so a
        // stale token doesn't leave the user staring at a dashboard full of
        // "Invalid or expired token" errors while still looking logged in.
        fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((res) => {
          if (res.status === 401) {
            localStorage.removeItem('pharma_token');
            localStorage.removeItem('pharma_user');
            set({ token: null, user: null, isAuthenticated: false });
            toast.error('Your session has expired. Please sign in again.');
          }
        }).catch(() => {
          // Network hiccup verifying the token — leave the session as-is
          // rather than logging the user out over a transient error.
        });
      } catch {
        localStorage.removeItem('pharma_token');
        localStorage.removeItem('pharma_user');
      }
    }
  },

  // Navigation
  activeView: 'dashboard',
  selectedBranchId: '',
  pendingTab: null,
  // `tab` lets a caller (e.g. a Dashboard KPI card) request that the
  // destination view lands on a specific tab rather than its default —
  // the destination view reads this once via consumePendingTab() on
  // mount/view-change and clears it, so navigating away and back later
  // doesn't get stuck re-applying a stale tab selection.
  setView: (view, tab) => set({ activeView: view, pendingTab: tab ?? null }),
  setBranch: (branchId) => set({ selectedBranchId: branchId }),
  consumePendingTab: () => {
    const tab = get().pendingTab;
    if (tab) set({ pendingTab: null });
    return tab;
  },

  // POS Cart
  posCart: [],
  addToCart: (item) =>
    set((state) => {
      const existing = state.posCart.find((c) => c.batchId === item.batchId);
      if (existing) {
        return {
          posCart: state.posCart.map((c) =>
            c.batchId === item.batchId
              ? { ...c, quantity: Math.min(c.quantity + item.quantity, c.availableQty) }
              : c
          ),
        };
      }
      return { posCart: [...state.posCart, item] };
    }),
  removeFromCart: (batchId) =>
    set((state) => ({
      posCart: state.posCart.filter((c) => c.batchId !== batchId),
    })),
  updateCartQty: (batchId, qty) =>
    set((state) => ({
      posCart: state.posCart.map((c) =>
        c.batchId === batchId ? { ...c, quantity: Math.max(1, Math.min(qty, c.availableQty)) } : c
      ),
    })),
  clearCart: () => set({ posCart: [] }),
}));

// Guards against firing the "session expired" toast/logout more than once
// when several requests 401 in quick succession (e.g. a page that fires off
// multiple authFetch calls on mount).
let sessionExpiryHandled = false;

/**
 * Auth-aware fetch wrapper. Adds Bearer token to all API requests.
 * Use this instead of raw fetch for API calls.
 *
 * If the server responds 401 (missing/invalid/expired token), the stored
 * session is cleared and the user is dropped back to the login screen
 * instead of the app silently showing "Invalid or expired token" errors
 * while still appearing logged in.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const state = usePharmacyStore.getState();
  const token = state.token;
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...options, headers });

  // Only treat this as a session expiry if we thought we were logged in.
  // (Avoids interfering with the login request itself, which also hits
  // this wrapper indirectly via other calls but isn't authenticated yet.)
  if (response.status === 401 && state.isAuthenticated) {
    if (!sessionExpiryHandled) {
      sessionExpiryHandled = true;
      toast.error('Your session has expired. Please sign in again.');
      usePharmacyStore.getState().logout();
      // Reset the guard shortly after so a future real session can trigger
      // this again if needed.
      setTimeout(() => {
        sessionExpiryHandled = false;
      }, 2000);
    }
  }

  return response;
}
