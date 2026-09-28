/**
 * Rotating a vault key — revocation that actually revokes.
 *
 * Removing a member deletes their `vault_members` row and nothing else, so a
 * member who kept their unwrapped copy can still decrypt every blob they ever had
 * access to — **including versions pushed after removal**. Rotation is what
 * closes that.
 *
 * ```
 * GET  /vaults/{id}/versions              → every version
 *   decryptVault(blob, OLD key, id, n)    → plaintext, in the Worker
 *   sealForPush(plaintext, NEW key, id, n)→ nonce, ciphertext, blake3
 * POST /vaults/{id}/rekey/blobs           → staged, one per version
 * POST /vaults/{id}/rekey                 → one atomic swap
 * ```
 *
 * ─── What rotation cannot do ────────────────────────────────────────────────
 *
 * ⚠️ It fixes the future, not the past. Someone who could already read a version
 * may hold a copy of it, and no server-side operation recalls that. The step
 * people skip is the one that matters: **rotate the secrets themselves**, at
 * their source. The UI says so where the action happens.
 *
 * ─── Why a half-finished run is safe ────────────────────────────────────────
 *
 * ⚠️ This module was not written for a long time because a half-finished re-key
 * was believed to leave a vault nobody could open. **It cannot.** The server
 * validates the entire payload before writing anything and commits in one
 * transaction, and staged blobs are uploaded under fresh keys that nothing
 * references until the swap. Abandoning a run — a closed tab, a dead network —
 * leaves orphaned objects in storage and a vault that still opens with its old
 * key. Wasted bytes, not a broken vault.
 *
 * The version number is re-used deliberately: `vault_aad(vault_id, version)` is
 * authenticated into every blob, so re-sealing v7 as v7 keeps the binding intact.
 * Re-numbering would break every client.
 */

"use client";

import {
  commitRekey,
  downloadBlob,
  getRecipientKeys,
  listMembers,
  listVersions,
  stageRekeyBlob,
  type RekeyedMember,
  type VaultMember,
} from "@/lib/api/vaults";
import { bytesToB64 } from "@/lib/api/encoding";
import {
  createVaultKey,
  decryptVault,
  sealForPush,
  wrapVaultKey,
  wrapVaultKeyForUser,
} from "@/lib/crypto/client";
import { useKeyStore } from "@/stores/keyStore";
import { vaultKeyFor } from "@/lib/vaults/open";

/** Where a run has got to, for a progress display. */
export type RekeyProgress = {
  phase: "reading" | "re-encrypting" | "re-wrapping" | "committing";
  done: number;
  total: number;
};

export type RekeyOptions = {
  /** Remove this member in the same transaction. Omit to rotate without removing. */
  removeUserId?: string;
  onProgress?: (p: RekeyProgress) => void;
};

/**
 * Rotate `vaultId`'s key, optionally revoking a member in the same transaction.
 *
 * Throws with a message meant for a person. Nothing about the vault has changed
 * unless this resolves.
 */
export async function rekeyVault(
  vaultId: string,
  { removeUserId, onProgress }: RekeyOptions = {},
): Promise<{ versions: number; members: number }> {
  const report = (p: RekeyProgress) => onProgress?.(p);

  // ── Who will hold the new key ────────────────────────────────────────────
  //
  // Read before anything is encrypted: if someone cannot be re-wrapped to, the
  // run must not start. Finding that out after re-encrypting forty versions
  // would waste the work and leave orphans for nothing.
  report({ phase: "reading", done: 0, total: 1 });
  const members = await listMembers(vaultId);
  const staying = members.filter((m) => m.user_id !== removeUserId);

  // ⚠️ Every remaining member needs an ML-KEM public key, and there is no
  // fallback. Wrapping one of them under X25519 alone would put the rotated
  // vault behind a primitive Shor breaks — so an account that has not signed in
  // since F1 blocks the rotation rather than silently weakening it. The members
  // list already shows who these are.
  const unwrappable = staying.filter((m) => !m.has_mlkem_key && !m.is_you);
  if (unwrappable.length > 0) {
    const who = unwrappable.map((m) => m.email).join(", ");
    const has = unwrappable.length === 1 ? "has" : "have";
    throw new Error(
      `${who} ${has} no post-quantum key yet, so the new vault key cannot be wrapped for them. They need to sign in once — here or with evnx 0.5 or later — and then this will work.`,
    );
  }

  const versions = await listVersions(vaultId);
  if (versions.length === 0) {
    throw new Error(
      "This vault has no versions yet, so there is nothing to re-encrypt. Remove the member directly instead.",
    );
  }

  const oldKey = await vaultKeyFor(vaultId);
  const newKey = await createVaultKey();

  // ── Re-encrypt every version under the new key ───────────────────────────
  //
  // Sequential, not parallel. Each iteration holds a full plaintext and a full
  // ciphertext in memory, and a vault with a long history on a phone is exactly
  // the case that would fall over — a slower run that finishes beats a faster one
  // that is killed. It also keeps the progress count honest.
  const staged: Array<{
    version_num: number;
    blob_key: string;
    blob_hash: string;
    blob_size_bytes: number;
  }> = [];

  for (const [i, v] of versions.entries()) {
    report({ phase: "re-encrypting", done: i, total: versions.length });

    const blob = await downloadBlob(vaultId, v.version_num);
    const plaintext = await decryptVault(blob, oldKey, vaultId, v.version_num);
    // Same version number: the AAD binds it, so re-sealing v7 as v7 is what
    // keeps every client able to open it.
    const sealed = await sealForPush(plaintext, newKey, vaultId, v.version_num);

    const result = await stageRekeyBlob(vaultId, {
      version_num: v.version_num,
      nonce: bytesToB64(sealed.nonce),
      ciphertext: bytesToB64(sealed.ciphertext),
      blob_hash: sealed.blobHash,
    });

    staged.push({
      version_num: result.version_num,
      blob_key: result.blob_key,
      blob_hash: sealed.blobHash,
      blob_size_bytes: result.blob_size_bytes,
    });
  }

  // ── Wrap the new key for everyone who stays ──────────────────────────────
  report({ phase: "re-wrapping", done: 0, total: staying.length });

  const wraps: RekeyedMember[] = [];
  for (const [i, m] of staying.entries()) {
    report({ phase: "re-wrapping", done: i, total: staying.length });
    wraps.push(await wrapFor(m, newKey));
  }

  report({ phase: "committing", done: 0, total: 1 });
  await commitRekey(vaultId, {
    versions: staged,
    members: wraps,
    ...(removeUserId ? { remove_user_id: removeUserId } : {}),
  });

  // ⚠️ The cached key is now the OLD one, and every blob is under the new one.
  // Leaving it would make the next open fail on a vault that is perfectly fine.
  // Dropping it costs one `my-key` round trip and is always correct.
  useKeyStore.getState().forgetVaultKey(vaultId);

  return { versions: staged.length, members: wraps.length };
}

/**
 * One member's copy of the new key.
 *
 * Our own goes under our master key — the shape a vault creator's copy has always
 * had, needing no key agreement. Everyone else's is a hybrid wrap from their
 * public keys, which the server requires to be whole.
 */
async function wrapFor(
  m: VaultMember,
  newKey: Awaited<ReturnType<typeof createVaultKey>>,
): Promise<RekeyedMember> {
  if (m.is_you) {
    return {
      user_id: m.user_id,
      encrypted_vault_key: bytesToB64(await wrapVaultKey(newKey)),
    };
  }

  const keys = await getRecipientKeys(m.email);
  if (!keys.mlkem_public_key) {
    // Checked before the run started; repeated here because the account could in
    // principle change between the two reads, and a wrap without it is one Shor
    // opens for as long as the row exists.
    throw new Error(
      `${m.email} has no post-quantum key, so the rotated vault key cannot be wrapped for them.`,
    );
  }

  const bundle = await wrapVaultKeyForUser(
    newKey,
    keys.x25519_public_key,
    keys.mlkem_public_key,
  );
  return {
    user_id: m.user_id,
    encrypted_vault_key: bundle.encryptedVaultKey,
    eph_pub_key: bundle.ephPubKey,
    mlkem_ciphertext: bundle.mlkemCiphertext,
  };
}
