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
 * corruption apart from a wrong key. `decryptVaultVersion` does not recompute it;
 * it reports that decryption failed on a blob the server vouched for, which
 * points at the key rather than the bytes.
 *
 * ⚠️ This used to say the client *cannot* compute blake3, "the wasm exports
 * none". It exports `blobHash`, and both `push.ts` and `rekey.ts` depend on it —
 * a push and a re-key staging request each carry a `blob_hash` the server
 * verifies, so a client that genuinely could not compute one would be unable to
 * write at all. Not recomputing it on read is a choice, not a limitation.
 */

"use client";

import {
  decryptVault,
  unwrapSharedVaultKey,
  unwrapVaultKey,
} from "@/lib/crypto/client";
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

  const { encrypted_vault_key, eph_pub_key, mlkem_ciphertext } =
    await getMyKey(vaultId);

  // ── A vault someone shared with us ───────────────────────────────────────
  //
  // Two cryptographically different cases, not two encodings of one. A vault we
  // created is sealed under the master key; a vault shared with us is wrapped to
  // our public keys, so it needs the account keypair. `unwrapVaultKey` expects
  // the first and fails confusingly on the second, which is why the branch
  // exists at all.
  //
  // ⚠️ This used to throw "this app cannot open yet. Use the CLI", on the
  // reasoning that sharing needed the ML-KEM hybrid from evnx-crypto 0.2.0 and
  // so no such key could exist. That shipped in F1 along with `evnx vault
  // share`, and the Worker has carried `unwrapSharedVaultKey` ever since — so
  // the app was refusing something it could already do, and telling people to go
  // elsewhere to read their own vault.
  if (eph_pub_key) {
    // Both halves or neither. The server's `vault_members_wrap_is_whole`
    // constraint makes any other pairing unstorable, so an ephemeral without a
    // ciphertext means the response is not what it claims to be — and the
    // post-quantum half is the entire point of the hybrid.
    if (!mlkem_ciphertext) {
      throw new Error(
        "This vault was shared with an incomplete key wrap — the post-quantum half is missing. Ask the owner to share it again.",
      );
    }

    const keypair = useKeyStore.getState().keypair;
    if (!keypair) {
      // Recovered during `unlock`, so its absence means the session is not
      // really unlocked rather than that anything is wrong with the vault.
      throw new Error("Session locked — sign in again to open a shared vault.");
    }

    const shared = await unwrapSharedVaultKey(
      keypair,
      encrypted_vault_key,
      eph_pub_key,
      mlkem_ciphertext,
    );
    useKeyStore.getState().setVaultKey(vaultId, shared);
    return shared;
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
