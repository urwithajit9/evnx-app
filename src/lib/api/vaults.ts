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
