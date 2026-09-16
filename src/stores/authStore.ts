/**
 * Who is signed in.
 *
 * Holds identity, never credentials: no password, no tokens, no key material.
 * Tokens live in module scope in `lib/api/client.ts`; keys live in the crypto
 * Worker. This store is the part that is safe for a component to render.
 *
 * ─── Signed in is TWO conditions, not one ────────────────────────────────────
 *
 * A usable session needs an access token *and* a master key in the Worker, and
 * they are lost at different moments. A reload drops both. A 15-minute access
 * token can expire and refresh silently while the master key persists. So
 * `useKeyStore.unlocked` is the authoritative gate for anything that decrypts,
 * and this store answers "who", not "can they".
 */

"use client";

import { create } from "zustand";
import { clearTokens } from "@/lib/api/client";
import { postLogout } from "@/lib/api/auth";
import { useKeyStore } from "./keyStore";
import type { MeResult } from "@/lib/api/auth";

export type AuthUser = {
  userId: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
};

type AuthState = {
  user: AuthUser | null;

  /**
   * Recovery codes left, captured at sign-in. `null` when unknown — which is
   * every login that did not go through a second factor, not "zero left".
   */
  backupCodesRemaining: number | null;

  /** Record a completed login. Call only after the master key is in the Worker. */
  signedIn: (me: MeResult, backupCodesRemaining: number | null) => void;

  /** Reflect a fresh `GET /auth/me` — e.g. after the user verifies their email. */
  refreshUser: (me: MeResult) => void;

  /** End the session everywhere: server, tokens, keys, this store. */
  signOut: () => Promise<void>;
};

function toUser(me: MeResult): AuthUser {
  return {
    userId: me.user_id,
    email: me.email,
    emailVerified: me.email_verified,
    totpEnabled: me.totp_enabled,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  backupCodesRemaining: null,

  signedIn: (me, backupCodesRemaining) => {
    set({ user: toUser(me), backupCodesRemaining });
    useKeyStore.getState().setUnlocked(true);
  },

  refreshUser: (me) => set({ user: toUser(me) }),

  signOut: async () => {
    // Local state first, in a fixed order, so a failure anywhere below still
    // leaves the tab locked. The alternative — telling the server first and
    // having the request hang — shows an apparently live session whose tokens
    // may already be revoked.
    set({ user: null, backupCodesRemaining: null });
    await useKeyStore.getState().lock();

    try {
      // Revokes the refresh token and blocklists the session id, so the access
      // token dies now rather than lingering for its remaining 15 minutes.
      await postLogout();
    } catch {
      // Offline, or the token already expired. Nothing to do: everything that
      // could decrypt anything is already gone from this tab.
    } finally {
      clearTokens();
    }
  },
}));
