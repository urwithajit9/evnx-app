/**
 * Session key state.
 *
 * ─── What this store deliberately does NOT hold ──────────────────────────────
 *
 * No key material. Not the master key, not vault keys, not the SRP password.
 *
 * The Phase 2 spec had `masterKey: Uint8Array` and `vaultKeys: Map<string,
 * Uint8Array>` living here, cleared with `.fill(0)` on logout. That is weaker
 * than it looks:
 *
 *   * `.fill(0)` overwrites the array you hold. It does not overwrite copies the
 *     JS engine made while compacting the heap, and there is no way to find them.
 *   * Anything in a Zustand store is reachable from React devtools, from an
 *     accidental `JSON.stringify`, and from any persistence middleware someone
 *     adds later without thinking about it.
 *
 * So the keys live in the crypto Worker's wasm memory, under Rust's
 * `ZeroizeOnDrop`, and this store holds only **references and flags**. A
 * `VaultKeyRef` is an opaque string like `vk_3` — useless to anyone who obtains
 * it, because it only means anything to the Worker that issued it.
 *
 * The practical upshot: "keys in memory only" becomes checkable rather than
 * aspirational. There is no API that returns key bytes, so no UI mistake can
 * persist one.
 */

"use client";

import { create } from "zustand";
import { clearKeys } from "@/lib/crypto/client";
import type { VaultKeyRef } from "@/lib/crypto/protocol";

type KeyState = {
  /**
   * Whether the Worker holds a master key.
   *
   * This is the authoritative "is the session usable" signal — not the access
   * token. A reopened tab has neither, but a token restored from anywhere while
   * the master key is absent still cannot decrypt anything, so the user must be
   * sent back to sign in regardless.
   */
  unlocked: boolean;

  /** Vault id → opaque Worker ref. Never a key. */
  vaultKeys: Record<string, VaultKeyRef>;

  setUnlocked: (v: boolean) => void;
  setVaultKey: (vaultId: string, ref: VaultKeyRef) => void;
  getVaultKey: (vaultId: string) => VaultKeyRef | undefined;

  /** Zeroize in the Worker and drop every local reference. */
  lock: () => Promise<void>;
};

export const useKeyStore = create<KeyState>((set, get) => ({
  unlocked: false,
  vaultKeys: {},

  setUnlocked: (unlocked) => set({ unlocked }),

  setVaultKey: (vaultId, ref) =>
    set((s) => ({ vaultKeys: { ...s.vaultKeys, [vaultId]: ref } })),

  getVaultKey: (vaultId) => get().vaultKeys[vaultId],

  lock: async () => {
    // Clear local state first. If the Worker call throws, the UI must still be
    // locked — the alternative is showing an unlocked session whose keys may or
    // may not still exist.
    set({ unlocked: false, vaultKeys: {} });
    try {
      await clearKeys();
    } catch {
      // A dead Worker has already lost its memory, which is the desired outcome.
    }
  },
}));
