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
   * Sharing is Phase 3; until then this is always null.
   */
  eph_pub_key: string | null;
};

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
