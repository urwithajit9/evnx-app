# evnx-app

The web dashboard for [evnx cloud](https://evnx.dev) — `app.evnx.dev`.

All cryptography runs in this browser. The server at `api.evnx.dev` only ever
holds ciphertext.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static export into out/
```

Open **`/selftest/`** first. It runs Argon2id and a full vault round trip through
the real crypto Worker and reports timings — including on a phone, which is the
case desktop numbers cannot answer.

## Architecture, and the reasons behind it

### Static export

`next.config.ts` sets `output: "export"`. Nothing here needs a server runtime: the
crypto is client-side by definition, and the API is called directly with a Bearer
token. That keeps hosting free (Cloudflare Pages, Netlify, anywhere) and keeps
every option open — a static bundle deploys wherever you like.

**There is deliberately no `middleware.ts`.** The Phase 2 spec had one gating on a
`refresh_token` cookie, but evnx-server issues no cookies at all — tokens come
back in the JSON body, the way the CLI consumes them. That check is permanently
false, so it would have redirected every logged-in user to the login page.

Route guarding is client-side by necessity anyway: the authoritative signal is
whether the crypto Worker holds a master key, and no server-side check can see
into Worker memory.

### Keys live in a Worker, never in JavaScript

```
src/lib/crypto/
  protocol.ts       message types — no message returns key material
  crypto.worker.ts  owns every MasterKeyHandle and VaultKeyHandle
  client.ts         promise-based RPC from the main thread
```

`@evnx/crypto-wasm` is the **same Rust** the CLI and server link against, compiled
to WebAssembly. One implementation, so the two clients cannot drift and produce
blobs the other cannot open.

Keys are **opaque handles**. `src/stores/keyStore.ts` holds refs like `vk_3` and a
boolean — never bytes. The spec originally put `Uint8Array` keys in Zustand and
cleared them with `.fill(0)`; that is weaker than it looks, because it cannot
reach copies the JS engine made while compacting the heap, and anything in a store
is reachable from devtools and from any persistence middleware added later.

### Measured performance

A login runs Argon2id **twice** — once for the SRP proof, once to unwrap the
keypair. On a 16-core desktop, in Chromium:

| | |
|---|---|
| `deriveMasterKey` | ≈148 ms |
| `deriveSrpPassword` | ≈147 ms |
| **login total** | **≈296 ms** |
| wasm init | 25–51 ms |
| bundle | 111 KB raw, 45 KB gzipped |

Essentially parity with native (304 ms).

> ⚠️ **Benchmark with the tab visible.** Chromium throttles hidden tabs hard — an
> earlier measurement in a hidden pane reported ~3× these times and was wrong. The
> tell: an identical probe recorded 464k ticks visible against 107k hidden. Check
> `document.visibilityState` before trusting any browser benchmark.

A Worker is still required — ~150 ms on the main thread drops frames on a click.
Measured in one, the main thread's worst event-loop gap was 5.3 ms against 5.5 ms
idle.

### Associated data is not optional

`encryptVault` and `decryptVault` both take `(vaultId, version)`, and it must match
on both sides. `/selftest/` asserts a blob sealed at v7 is **rejected** at v8 and
rejected for a different vault id.

This is what stops a compromised server replaying an old version as current. The
consequence: **a 409 conflict requires re-encryption, not a retry** — the bytes you
built are bound to a version number that is no longer correct.

## Dependency on @evnx/crypto-wasm

Built from the `evnx-crypto` repo:

```bash
cd ../evnx-crypto && ./scripts/build-wasm.sh
```

Until it is published, `package.json` points at the local build via `file:`. Once
`@evnx/crypto-wasm` is on npm, change it to a version range:

```json
"@evnx/crypto-wasm": "^0.1.0"
```

## Environment

```
NEXT_PUBLIC_API_URL=https://api.evnx.dev    # optional; this is the default
```

The server must allow this origin in CORS. `FRONTEND_URL` on evnx-server accepts a
comma-separated list, so one deployment can serve both `https://app.evnx.dev` and a
local `http://localhost:3000`.
