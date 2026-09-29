/**
 * Vault and version endpoints.
 *
 * Every route here sits behind `require_verified`, so an account that has not
 * clicked its verification link gets 403 — not 401. The UI must tell those two
 * apart: one means sign in again, the other means check your email.
 */

"use client";

import { api } from "./client";

// ─── Vaults ──────────────────────────────────────────────────────────────────

export type VaultSummary = {
  id: string;
  name: string;
  environment: string;
  /** `owner` | `admin` | `member` — only an owner may delete. */
  role: string;
  version_count: number;
  updated_at: string;
};

export async function listVaults(): Promise<VaultSummary[]> {
  const { data } = await api.get<{ vaults: VaultSummary[] }>("/vaults");
  return data.vaults;
}

export type MyKey = {
  /** base64 of `nonce(24) || ciphertext`, XChaCha20 under the master key. */
  encrypted_vault_key: string;
  /**
   * `null` for the creator's own copy, which is wrapped under the master key
   * with no ECDH involved.
   *
   * That null is load-bearing rather than an omission: it is what makes a solo
   * vault post-quantum safe. A non-null ephemeral means the key was wrapped
   * *for* this user by someone else over X25519, which Shor breaks — so the two
   * cases are cryptographically different, not two encodings of one thing.
   * Non-null since Phase 3, when a vault is shared with you.
   */
  eph_pub_key: string | null;
  /**
   * The ML-KEM-768 half of a shared wrap. Always present alongside
   * `eph_pub_key` and always absent without it — the server's
   * `vault_members_wrap_is_whole` constraint makes any other pairing unstorable.
   */
  mlkem_ciphertext?: string | null;
};

// ─── Members ─────────────────────────────────────────────────────────────────

export type VaultRole = "viewer" | "developer" | "admin" | "owner";

/** Roles that can be assigned. `owner` is set once, by vault creation. */
export const ASSIGNABLE_ROLES: VaultRole[] = ["viewer", "developer", "admin"];

/** The ladder. A higher number outranks a lower one — mirrors the server's `Role`. */
export const ROLE_RANK: Record<VaultRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

export type VaultMember = {
  user_id: string;
  email: string;
  role: VaultRole;
  granted_at: string;
  granted_by: string | null;
  /**
   * `false` for an account created before the post-quantum wrap existed that has
   * not signed in since. **Such a member cannot be re-wrapped to**, so a re-key
   * will refuse while they are present — surfaced so the UI can say why before
   * the action fails rather than after.
   */
  has_mlkem_key: boolean;
  is_you: boolean;
};

export async function listMembers(vaultId: string): Promise<VaultMember[]> {
  const { data } = await api.get<{ members: VaultMember[] }>(
    `/vaults/${vaultId}/members`,
  );
  return data.members;
}

/**
 * Change a member's role.
 *
 * The server refuses unless you outrank both their current role and the new one,
 * so an admin can move people between viewer and developer while only an owner
 * can make or unmake an admin.
 */
export async function setMemberRole(
  vaultId: string,
  userId: string,
  role: VaultRole,
): Promise<void> {
  await api.patch(`/vaults/${vaultId}/members/${userId}`, { role });
}

/**
 * Remove a member **without** rotating the vault key.
 *
 * ⚠️ They keep the ability to decrypt every version they had access to,
 * including ones pushed afterwards. Only correct when re-keying separately.
 * The UI should reach for the re-key flow instead.
 */
export async function removeMember(
  vaultId: string,
  userId: string,
): Promise<void> {
  await api.delete(`/vaults/${vaultId}/members/${userId}`);
}

/**
 * Delete a vault and every version in it.
 *
 * Owner only — the server guards this with `OwnerOnly` rather than `AtLeastAdmin`.
 * An admin may share, revoke and re-key; destroying the vault, and everyone else's
 * access with it, stays with the account that created it.
 *
 * A **soft** delete: the row is marked rather than removed, so the name stays taken
 * and the blobs are not immediately unreachable. That is the server's choice, not a
 * promise to the user — the UI should not imply the data is recoverable.
 */
export async function deleteVault(vaultId: string): Promise<void> {
  await api.delete(`/vaults/${vaultId}`);
}

/** A recipient's public keys, from `GET /users/{email}/public-key`. */
export type RecipientKeys = {
  x25519_public_key: string;
  ed25519_public_key: string;
  /**
   * ⚠️ **Null for an account that predates F1**, and a client must refuse to
   * share in that case rather than wrapping under X25519 alone. A wrap missing
   * its post-quantum half is one Shor opens, and it stays that way for as long as
   * the row exists — an adversary recording it does not care that a later version
   * fixed the algorithm. The account gets one on its next sign-in.
   */
  mlkem_public_key: string | null;
};

/**
 * The recipient's public keys.
 *
 * ⚠️ **These come from the server.** A malicious server could substitute its own
 * and read everything shared afterwards. There is no third party to check them
 * against and out-of-band fingerprint verification is not built, so "the server
 * cannot read your secrets" becomes "…cannot read them *passively*" the moment
 * you share. The CLI carries the same caveat.
 *
 * A 404 means no account, deliberately — the endpoint does not distinguish
 * "no such user" from anything else, to avoid confirming which addresses exist.
 */
export async function getRecipientKeys(email: string): Promise<RecipientKeys> {
  const { data } = await api.get<RecipientKeys>(
    `/users/${encodeURIComponent(email.trim().toLowerCase())}/public-key`,
  );
  return data;
}

/** Body of `POST /vaults/{id}/members`. */
export type AddMemberBody = {
  user_email: string;
  role: VaultRole;
  /** The vault key wrapped for the recipient — hybrid X25519 + ML-KEM-768. */
  encrypted_vault_key: string;
  /** The sender's ephemeral X25519 public key. 44 base64 characters. */
  eph_pub_key: string;
  /** The ML-KEM-768 ciphertext. 1452 base64 characters. Required, not optional. */
  mlkem_ciphertext: string;
};

/**
 * Share a vault with another account.
 *
 * Requires **admin or above**, and you may only grant a role you outrank — an
 * admin granting `admin` would create a peer neither could remove, since removal
 * also requires outranking the target.
 */
export async function addMember(
  vaultId: string,
  body: AddMemberBody,
): Promise<void> {
  await api.post(`/vaults/${vaultId}/members`, body);
}

export async function getMyKey(vaultId: string): Promise<MyKey> {
  const { data } = await api.get<MyKey>(`/vaults/${vaultId}/my-key`);
  return data;
}

// ─── Versions ────────────────────────────────────────────────────────────────

export type VersionMeta = {
  version_num: number;
  /** blake3 of the ciphertext, hex. */
  blob_hash: string;
  key_count: number;
  /** Key names only — never values. The server has never seen a value. */
  key_names: string[];
  blob_size_bytes: number;
  pushed_by: string;
  pushed_at: string;
};

export async function listVersions(vaultId: string): Promise<VersionMeta[]> {
  const { data } = await api.get<{ versions: VersionMeta[] }>(
    `/vaults/${vaultId}/versions`,
  );
  return data.versions;
}

/** 404 when the vault has never been pushed to. */
export async function getLatestVersion(vaultId: string): Promise<VersionMeta> {
  const { data } = await api.get<VersionMeta>(`/vaults/${vaultId}/versions/latest`);
  return data;
}

/**
 * Download one version's blob: `nonce(12) || ciphertext`, raw bytes.
 *
 * The response also carries `X-Blob-Hash`, which **this browser cannot read** —
 * the server's CORS layer sets no `Access-Control-Expose-Headers`, so only the
 * safelisted response headers are visible to script. Not a problem: the same
 * hash is in the JSON from `listVersions`, and the server re-verifies the blob
 * against it before sending a byte.
 */
export async function downloadBlob(
  vaultId: string,
  versionNum: number,
): Promise<Uint8Array> {
  const { data } = await api.get<ArrayBuffer>(
    `/vaults/${vaultId}/versions/${versionNum}/blob`,
    { responseType: "arraybuffer" },
  );
  return new Uint8Array(data);
}

// ─── Re-keying ───────────────────────────────────────────────────────────────
//
// ⚠️ **Two requests, and it cannot be one.** Re-encrypting a vault produces one
// new blob per version, and `MAX_REQUEST_SIZE_KB` defaults to 64 KB — a single
// version can approach that, so a vault with any history would be unre-keyable,
// and an unre-keyable vault is one whose members cannot be revoked.
//
// Blobs are staged individually, then **one** request swaps all the metadata in a
// single transaction. The server validates the whole payload before writing
// anything, so there is no partial state to recover from: an abandoned re-key
// leaves orphaned objects in storage — wasted bytes, never referenced — and the
// vault still opens with its old key.

export type StagedBlob = {
  version_num: number;
  /** From the server. Never constructed by the client. */
  blob_key: string;
  blob_size_bytes: number;
};

/** Upload one re-encrypted version. Nothing about the vault changes yet. */
export async function stageRekeyBlob(
  vaultId: string,
  body: {
    version_num: number;
    nonce: string;
    ciphertext: string;
    blob_hash: string;
  },
): Promise<StagedBlob> {
  const { data } = await api.post<StagedBlob>(
    `/vaults/${vaultId}/rekey/blobs`,
    body,
  );
  return data;
}

/**
 * One member's copy of the **new** vault key.
 *
 * Two shapes, and the distinction is load-bearing. Both key-agreement fields
 * present is a hybrid wrap, produced from someone's public keys. Both absent is a
 * wrap under the caller's own master key — and **only the caller may use that
 * shape**, because only they hold their own master key. Supplying it for anyone
 * else writes a blob nobody can open and locks that member out; the server
 * rejects it.
 */
export type RekeyedMember = {
  user_id: string;
  encrypted_vault_key: string;
  eph_pub_key?: string;
  mlkem_ciphertext?: string;
};

/**
 * Rotate the key: repoint every version and re-wrap for every member, atomically.
 *
 * `versions` must cover **exactly** the vault's versions — the server answers 409
 * otherwise, because a vault split across two keys cannot be opened by anyone.
 */
export async function commitRekey(
  vaultId: string,
  body: {
    versions: Array<{
      version_num: number;
      blob_key: string;
      blob_hash: string;
      blob_size_bytes: number;
    }>;
    members: RekeyedMember[];
    remove_user_id?: string;
  },
): Promise<void> {
  await api.post(`/vaults/${vaultId}/rekey`, body);
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

/**
 * One thing that happened to a vault.
 *
 * ⚠️ `ip_hash` and `user_agent_hash` are deliberately **not** returned by the
 * server. They are stable digests, so they correlate a person's activity across
 * events without naming them — worth having in the database, not worth handing
 * to every colleague who shares a vault.
 */
export type AuditEvent = {
  id: string;
  event_type: string;
  user_id: string | null;
  /** `null` when that account has since been deleted. */
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function listAudit(vaultId: string): Promise<AuditEvent[]> {
  const { data } = await api.get<{ events: AuditEvent[] }>(
    `/vaults/${vaultId}/audit`,
  );
  return data.events;
}
