/**
 * Opening a vault version — the read half of sync, in the browser.
 *
 * ```
 * GET  /vaults/{id}/my-key              → encrypted_vault_key (base64)
 *   unwrapVaultKey(bytes, masterKey)    → VaultKeyRef, in the Worker
 * GET  /vaults/{id}/versions/{n}/blob   → nonce(12) || ciphertext
 *   decryptVault(blob, key, id, n)      → plaintext bytes
 * ```
 *
 * ─── The version number is authenticated, not incidental ─────────────────────
 *
 * `vault_aad(vault_id, version)` is bound into the ciphertext, so decryption
 * fails unless `n` is exactly the version the blob was sealed at. That is what
 * stops a malicious server replaying an old version as the current one — it
 * cannot relabel a blob without breaking it.
 *
 * The practical consequence: **pass the version you actually fetched.** Never
 * resolve "latest" separately from the download. A push landing between the two
 * calls makes the numbers disagree and decryption fails for a blob that is
 * perfectly intact.
 *
 * ─── Why there is no blake3 check here ───────────────────────────────────────
 *
 * `blob_hash` is transport integrity, and AES-256-GCM already provides a
 * stronger form of it: the auth tag is *keyed*, so a modified ciphertext fails
 * to decrypt rather than merely failing to match a hash anyone could recompute.
 * The server also re-verifies blake3 against its own record before sending.
 *
 * So the blob hash here is a **diagnostic**, and only useful for telling storage
 * corruption apart from a wrong key. `decryptVaultVersion` reports which, when
 * the caller supplies the expected hash — it cannot compute blake3 (the wasm
 * exports none) but it can say that decryption failed on a blob the server
 * vouched for, which points at the key rather than the bytes.
 */

"use client";

import { decryptVault, unwrapVaultKey } from "@/lib/crypto/client";
import { downloadBlob, getMyKey } from "@/lib/api/vaults";
import { useKeyStore } from "@/stores/keyStore";
import { b64ToBytes } from "@/lib/api/encoding";
import type { VaultKeyRef } from "@/lib/crypto/protocol";

/**
 * The vault key for `vaultId`, unwrapping it on first use and reusing the
 * Worker ref afterwards.
 *
 * Caching matters: without it every version you click re-fetches and re-unwraps.
 * The cache lives in the key store and holds refs, never key bytes, and dies
 * with the session.
 */
export async function vaultKeyFor(vaultId: string): Promise<VaultKeyRef> {
  const cached = useKeyStore.getState().getVaultKey(vaultId);
  if (cached) return cached;

  const { encrypted_vault_key, eph_pub_key } = await getMyKey(vaultId);

  if (eph_pub_key) {
    // Sharing is Phase 3 and needs the ML-KEM hybrid in evnx-crypto 0.2.0, so
    // no ECDH-wrapped key should exist yet. Refuse rather than mis-unwrap:
    // `unwrapVaultKey` expects a master-key wrap and would fail confusingly.
    throw new Error(
      "This vault key was shared with you using ECDH, which this app cannot open yet. Use the CLI.",
    );
  }

  const ref = await unwrapVaultKey(b64ToBytes(encrypted_vault_key));
  useKeyStore.getState().setVaultKey(vaultId, ref);
  return ref;
}

export type OpenedVersion = {
  versionNum: number;
  /** The raw file, exactly as it was pushed. */
  text: string;
};

/**
 * Download and decrypt one version.
 *
 * `versionNum` must be the version being downloaded — it is authenticated into
 * the ciphertext. See the module note.
 */
export async function openVersion(
  vaultId: string,
  versionNum: number,
): Promise<OpenedVersion> {
  const key = await vaultKeyFor(vaultId);
  const blob = await downloadBlob(vaultId, versionNum);

  const plaintext = await decryptVault(blob, key, vaultId, versionNum);
  return {
    versionNum,
    // The CLI pushes raw file bytes, so this is the file. Decoding as UTF-8 is
    // for display only; nothing here re-encodes or writes it back.
    text: new TextDecoder().decode(plaintext),
  };
}
