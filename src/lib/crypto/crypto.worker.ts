/**
 * The crypto Worker. Every Argon2id derivation and every vault operation runs here.
 *
 * ─── Why a Worker is mandatory, not a nicety ─────────────────────────────────
 *
 * Argon2id is memory-hard by design: 64 MiB, t=3, p=4. Measured in Chromium on a
 * sixteen-core desktop it takes **≈148 ms**, and a login runs it **twice** — once
 * for the SRP proof, once to unwrap the keypair — so ≈296 ms of solid CPU.
 *
 * On the main thread that is a third of a second of dropped frames. In a Worker
 * the main thread is untouched: measured worst event-loop gap during a full
 * derivation was 5.3 ms, against 5.5 ms while idle.
 *
 * (Measure with the tab VISIBLE. A hidden tab is throttled and reports roughly
 * 3× these times — which is exactly the mistake that produced this file's first
 * set of numbers.)
 *
 * ─── Why keys never leave ────────────────────────────────────────────────────
 *
 * Handles stay in this scope. JavaScript values live in a garbage-collected heap
 * with no `ZeroizeOnDrop` equivalent: the engine may copy a buffer while
 * compacting, and nothing says when the original is released. The Rust side keeps
 * the bytes under `Zeroizing` and hands out opaque handles, and this file is what
 * preserves that boundary on the JS side.
 */

import init, {
  deriveMasterKey,
  deriveSrpPassword,
  generateSalt,
  createVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptVault,
  decryptVault,
  type MasterKeyHandle,
  type VaultKeyHandle,
} from "@evnx/crypto-wasm";

import type { CryptoRequest, CryptoResponse, VaultKeyRef } from "./protocol";

let ready: Promise<unknown> | null = null;

/** The one master key for this session. Never serialised, never posted out. */
let masterKey: MasterKeyHandle | null = null;

/** Vault keys by opaque ref. The main thread holds only the ref strings. */
const vaultKeys = new Map<VaultKeyRef, VaultKeyHandle>();
let refCounter = 0;

function ensureInit() {
  // `init()` is idempotent in practice, but a single shared promise means
  // concurrent messages arriving before the wasm is up all await the same load
  // rather than racing several fetches of the same module.
  ready ??= init();
  return ready;
}

function requireMasterKey(): MasterKeyHandle {
  if (!masterKey) {
    // Reached when the tab was reopened, or after logout. The UI must send the
    // user back to sign in — there is nothing to recover from here.
    throw new Error("locked: no master key in memory");
  }
  return masterKey;
}

function requireVaultKey(ref: VaultKeyRef): VaultKeyHandle {
  const vk = vaultKeys.get(ref);
  if (!vk) throw new Error(`unknown vault key ref: ${ref}`);
  return vk;
}

function storeVaultKey(vk: VaultKeyHandle): VaultKeyRef {
  const ref = `vk_${++refCounter}`;
  vaultKeys.set(ref, vk);
  return ref;
}

/** Zeroize everything now, rather than waiting for GC to get round to it. */
function clearAll() {
  masterKey?.destroy();
  masterKey = null;
  for (const vk of vaultKeys.values()) vk.destroy();
  vaultKeys.clear();
}

async function handle(req: CryptoRequest): Promise<unknown> {
  await ensureInit();

  switch (req.kind) {
    case "init":
      return { ready: true };

    case "deriveMasterKey": {
      // Replacing an existing key must free the old one first, or a re-login
      // leaves the previous master key sitting in wasm memory until GC.
      masterKey?.destroy();
      masterKey = deriveMasterKey(req.password, req.argon2SaltB64);
      return { derived: true };
    }

    case "deriveSrpPassword":
      // Leaves the Worker by necessity: it is an input to the SRP exchange, not
      // a stored key. Still password-equivalent — the caller uses it for the
      // proof and drops the reference.
      return deriveSrpPassword(req.password, req.srpSaltB64);

    case "generateSalt":
      return generateSalt();

    case "createVaultKey":
      return storeVaultKey(createVaultKey());

    case "wrapVaultKey":
      return wrapVaultKey(requireVaultKey(req.vaultKey), requireMasterKey());

    case "unwrapVaultKey":
      return storeVaultKey(unwrapVaultKey(req.wrapped, requireMasterKey()));

    case "encryptVault":
      return encryptVault(
        req.plaintext,
        requireVaultKey(req.vaultKey),
        req.vaultId,
        req.version,
      );

    case "decryptVault":
      // Fails identically for a wrong key, a tampered blob and a mismatched
      // version. That is deliberate on the Rust side; do not try to distinguish.
      return decryptVault(
        req.blob,
        requireVaultKey(req.vaultKey),
        req.vaultId,
        req.version,
      );

    case "clear":
      clearAll();
      return { cleared: true };
  }
}

self.onmessage = async (e: MessageEvent<CryptoRequest>) => {
  const req = e.data;
  try {
    const result = await handle(req);
    self.postMessage({ id: req.id, ok: true, result } satisfies CryptoResponse);
  } catch (err) {
    // Only the message crosses back, never the error object: a structured-clone
    // of a wasm error can drag its internals along with it.
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CryptoResponse);
  }
};
