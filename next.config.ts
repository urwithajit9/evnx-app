import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export. Nothing in this app needs a server runtime:
  //
  //   * All crypto runs in the browser — that is the whole point of the product.
  //   * The API lives at api.evnx.dev and is called directly with a Bearer token.
  //   * Route guarding is client-side by necessity. The authoritative signal is
  //     whether a master key exists in the crypto Worker's memory, which no
  //     server-side check can see. `middleware.ts` cannot implement it, and the
  //     version specced in phase_2 gated on a `refresh_token` cookie the server
  //     has never issued — so it would have redirected every logged-in user to
  //     the login page.
  //
  // Keeping the build static also keeps hosting options open: a static bundle
  // deploys to Cloudflare Pages, Netlify, Vercel or the VPS unchanged.
  output: "export",

  // Required by `output: export` — there is no server to optimise images.
  images: { unoptimized: true },

  // Emit `/vaults/index.html` rather than `/vaults.html`, which is what static
  // hosts expect when serving clean URLs.
  trailingSlash: true,

  // Fail the build on type errors rather than shipping them. Already the default;
  // stated explicitly so disabling it has to be a deliberate edit.
  //
  // There is no `eslint` key here: Next 16 removed it, and leaving it in makes
  // the build warn about an unrecognised option and then fail type checking.
  // Linting runs as its own `npm run lint` step.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
