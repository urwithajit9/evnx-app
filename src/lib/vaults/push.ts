/**
 * Pushing a version from the browser — the write half of sync.
 *
 * ─── The version number has to be predicted, and `base_version` is what makes
 *     predicting it safe ──────────────────────────────────────────────────────
 *
 * `vault_aad(vault_id, version)` is authenticated into the ciphertext, and the
 * server assigns `current + 1`. So the client must seal the blob at a version
 * number **before** sending it, guessing what the server will choose.
 *
 * `base_version` is the guard on that guess. If someone else pushed in between,
 * the server answers **409** rather than assigning a different number — which
 * would otherwise store a blob sealed at a version nobody could ever open.
 *
 * ─── Which is why a 409 is not retryable ─────────────────────────────────────
 *
 * Re-sending the same bytes cannot work: they are sealed at a version that is no
 * longer the next one. The plaintext has to be encrypted again.
 *
 * And that re-encryption is **not** automatic here. Doing it silently would
 * overwrite whatever the other person just pushed, with no one the wiser. The
 * conflict surfaces as {@link VersionConflictError} carrying the remote's
 * current version, and re-pushing is a decision the user makes — the same stance
 * the CLI takes, which tells you to pull, re-apply and push again.
 */

"use client";

import { sealForPush } from "@/lib/crypto/client";
import { vaultKeyFor } from "./open";
import { getLatestVersion, listVersions } from "@/lib/api/vaults";
import { api, apiErrorCode, apiErrorStatus } from "@/lib/api/client";
import { bytesToB64 } from "@/lib/api/encoding";
import { parseEnv } from "@/lib/env/parse";

export class VersionConflictError extends Error {
  constructor(
    /** What the server says the latest version is now. */
    readonly remoteVersion: number,
    /** What this push was sealed against. */
    readonly basedOn: number,
  ) {
    super(
      `Someone pushed v${remoteVersion} while you were working; this was based on v${basedOn}. Review what changed before pushing again — the version is authenticated into the ciphertext, so the same bytes cannot simply be re-sent.`,
    );
    this.name = "VersionConflictError";
  }
}

export type PushResult = {
  versionNum: number;
  pushedAt: string;
  keyNames: string[];
};

/**
 * Encrypt `plaintext` and upload it as the next version.
 *
 * `plaintext` is the file's **raw bytes**. Nothing here reformats, normalises or
 * round-trips it through a parser — a pull must return exactly what went in, and
 * the CLI's byte-identity guarantee depends on this client honouring the same
 * rule.
 */
export async function pushVersion(
  vaultId: string,
  plaintext: Uint8Array,
): Promise<PushResult> {
  const base = await currentVersion(vaultId);
  const target = base + 1;

  const key = await vaultKeyFor(vaultId);
  const sealed = await sealForPush(plaintext, key, vaultId, target);

  // Key NAMES travel in the clear so a vault can be listed without decrypting.
  // Values never do. Parsing failure is not fatal: the bytes still push, the
  // vault just lists no names — matching the CLI, which says the same.
  const keyNames = keyNamesOf(plaintext);

  try {
    const { data } = await api.post<{ version_num: number; pushed_at: string }>(
      `/vaults/${vaultId}/versions`,
      {
        nonce: bytesToB64(sealed.nonce),
        ciphertext: bytesToB64(sealed.ciphertext),
        blob_hash: sealed.blobHash,
        key_names: keyNames,
        key_count: keyNames.length,
        // Always sent. Omitting it makes the server skip the check entirely and
        // append blindly, which is exactly the race this exists to prevent.
        base_version: base,
      },
    );
    return { versionNum: data.version_num, pushedAt: data.pushed_at, keyNames };
  } catch (e) {
    if (apiErrorStatus(e) === 409 || apiErrorCode(e) === "CONFLICT") {
      // Re-read rather than parse the server's prose for a number.
      const now = await currentVersion(vaultId).catch(() => base);
      throw new VersionConflictError(now, base);
    }
    throw e;
  }
}

/**
 * The vault's current version, or 0 when nothing has been pushed.
 *
 * `/versions/latest` answers 404 for an empty vault, which is a legitimate state
 * and not an error — the server's own `current_num` starts at 0 the same way.
 */
export async function currentVersion(vaultId: string): Promise<number> {
  try {
    const latest = await getLatestVersion(vaultId);
    return latest.version_num;
  } catch (e) {
    if (apiErrorStatus(e) === 404) return 0;
    throw e;
  }
}

/** Re-read the history after a push, so callers can refresh without guessing. */
export async function historyAfterPush(vaultId: string) {
  return listVersions(vaultId);
}

function keyNamesOf(plaintext: Uint8Array): string[] {
  try {
    // `fatal` so invalid UTF-8 throws rather than yielding replacement
    // characters — a binary file should record no names, not garbage ones.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    return parseEnv(text).entries.map((e) => e.key);
  } catch {
    return [];
  }
}
