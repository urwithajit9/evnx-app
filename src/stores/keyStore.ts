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
import type { KeypairRef, VaultKeyRef } from "@/lib/crypto/protocol";

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

  /**
   * Opaque Worker ref to the account keypair. Never a key.
   *
   * ⚠️ Needed for **shared** vaults, and nothing else. A vault we created is
   * sealed under the master key, but a vault shared with us is wrapped to these
   * public keys, so opening one needs the keypair rather than the password.
   *
   * `unlock` already recovered it at login and then dropped the ref on the floor,
   * which is why the app refused every shared vault with "use the CLI" — the
   * keypair was sitting in the Worker the whole time, unreachable. The Worker
   * holds it until `clearKeys`, so this is a reference to something already
   * alive, not a second copy.
   */
  keypair?: KeypairRef;

  setUnlocked: (v: boolean) => void;
  setKeypair: (ref: KeypairRef) => void;
  setVaultKey: (vaultId: string, ref: VaultKeyRef) => void;
  getVaultKey: (vaultId: string) => VaultKeyRef | undefined;

  /** Zeroize in the Worker and drop every local reference. */
  lock: () => Promise<void>;
};

export const useKeyStore = create<KeyState>((set, get) => ({
  unlocked: false,
  vaultKeys: {},

  setUnlocked: (unlocked) => set({ unlocked }),

  setKeypair: (keypair) => set({ keypair }),

  setVaultKey: (vaultId, ref) =>
    set((s) => ({ vaultKeys: { ...s.vaultKeys, [vaultId]: ref } })),

  getVaultKey: (vaultId) => get().vaultKeys[vaultId],

  lock: async () => {
    // Clear local state first. If the Worker call throws, the UI must still be
    // locked — the alternative is showing an unlocked session whose keys may or
    // may not still exist.
    // ⚠️ `keypair` goes too. Leaving it would keep a ref to Worker state that
    // `clearKeys` is about to destroy, so the next shared-vault open would fail
    // on a dangling ref rather than on being locked — the same class of
    // half-unlocked session `unlock` already guards against.
    set({ unlocked: false, vaultKeys: {}, keypair: undefined });
    try {
      await clearKeys();
    } catch {
      // A dead Worker has already lost its memory, which is the desired outcome.
    }
  },
}));
