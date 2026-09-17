/**
 * Creating a vault.
 *
 * A fresh 256-bit key is generated in the Worker and wrapped under the master
 * key before anything leaves the browser. The server stores only the wrapped
 * form and never sees the key.
 *
 * ─── `eph_pub_key` is omitted, and that is the security-relevant part ────────
 *
 * There are two ways a vault key gets wrapped, and they are cryptographically
 * different rather than two encodings of one thing:
 *
 * | Whose copy | How | `eph_pub_key` | Post-quantum |
 * |---|---|---|---|
 * | the creator's own | XChaCha20 under an HKDF subkey of the master key | **omitted** | ✅ symmetric only |
 * | a member's, when shared | X25519 ECDH to their public key | the ephemeral | ❌ Shor breaks X25519 |
 *
 * `wrapVaultKey` is the first row: no ECDH, so there is no ephemeral to send.
 * Sending one would mean the creator's own copy had gone through ECDH, which
 * would put every solo vault behind X25519 and expose it to
 * harvest-now-decrypt-later. The field is optional on the server and the column
 * is nullable for exactly this reason.
 */

"use client";

import { createVaultKey, wrapVaultKey } from "@/lib/crypto/client";
import { api } from "@/lib/api/client";
import { bytesToB64 } from "@/lib/api/encoding";
import { useKeyStore } from "@/stores/keyStore";

/** Mirrors the server's `NAME_RE` — lowercase alphanumeric and hyphens, 1–64. */
const NAME_RE = /^[a-z0-9-]+$/;

export function validateVaultName(name: string): string | null {
  if (name.length === 0) return "Give the vault a name.";
  if (name.length > 64) return "Vault names are at most 64 characters.";
  if (!NAME_RE.test(name)) {
    return "Use lowercase letters, digits and hyphens only.";
  }
  return null;
}

export type CreatedVault = {
  vault_id: string;
  name: string;
  environment: string;
};

export async function createVault(
  name: string,
  environment: string,
): Promise<CreatedVault> {
  const nameError = validateVaultName(name);
  if (nameError) throw new Error(nameError);
  if (!environment.trim()) throw new Error("Give the vault an environment.");

  const vaultKey = await createVaultKey();
  const wrapped = await wrapVaultKey(vaultKey);

  const { data } = await api.post<CreatedVault>("/vaults", {
    name,
    environment: environment.trim(),
    encrypted_vault_key: bytesToB64(wrapped),
    // No `eph_pub_key`. See the module note — this is not an omission.
  });

  // The key is already unwrapped in the Worker, so cache the ref against the id
  // the server just assigned. Without this the next push re-fetches and
  // re-unwraps a key that is sitting right there.
  useKeyStore.getState().setVaultKey(data.vault_id, vaultKey);

  return data;
}
