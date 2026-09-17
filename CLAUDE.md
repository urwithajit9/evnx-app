# evnx-app — notes for Claude

Read `README.md` first; it carries the architecture and the reasoning.

The short version of what must not be broken:

1. **No key material in JavaScript.** Keys live in the crypto Worker as opaque
   handles. There is no API that returns key bytes, and adding one would undo the
   guarantee the whole product rests on.
2. **No `middleware.ts`.** The server issues no cookies, so a server-side guard has
   nothing to read. Guard in `app/(dashboard)/layout.tsx` instead.
3. **`output: "export"` stays.** Adding an API route or a server action silently
   breaks the build target and the hosting plan.
4. **`encryptVault`/`decryptVault` always take `(vaultId, version)`.** Omitting or
   faking the version produces blobs the CLI cannot open — and nothing fails until
   the first cross-client pull.
5. **Benchmark with the tab visible.** Hidden tabs are throttled ~3×.

Project-wide spec: `../CLAUDE.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
