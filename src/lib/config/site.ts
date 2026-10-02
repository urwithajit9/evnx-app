/**
 * Hosts and cross-property links for app.evnx.dev.
 *
 * ⚠️ WHY THIS DUPLICATES `@evnx/config` IN evnx-web, AND WHERE THE LINE IS.
 *
 * ADR-3 keeps `evnx-app` a separate repository on a separate host, on purpose:
 * the product surface must not share a build, a dependency tree or a deploy
 * trigger with marketing. So it cannot import that package, and the *shape*
 * below is duplicated knowingly.
 *
 * What is NOT duplicated is anything that can drift into being wrong:
 *
 *   • Plan limits — read from `GET /auth/usage` at runtime, never written here.
 *   • The CLI version — this app does not state it, so it cannot go stale.
 *   • The API origin — `NEXT_PUBLIC_API_URL`, already configurable.
 *
 * Duplicating a shape is maintenance. Duplicating a number is a second source
 * of truth, and the second one is always the one that goes stale.
 */

export const HOSTS = {
  /** Marketing. ⚠️ `evnx.dev` 307s to `www`, so link to the host that answers. */
  web: "https://www.evnx.dev",
  /** Documentation. Does not exist yet — see DOCS_MODE. */
  docs: "https://docs.evnx.dev",
  /** This app. */
  app: "https://app.evnx.dev",
} as const;

/**
 * ⚠️ THE SPLIT SWITCH — AND IT HAS A TWIN.
 *
 * `inline` — docs are at evnx.dev/guides/* (today).
 * `split`  — docs are at docs.evnx.dev/cli/* (after schedule P3).
 *
 * evnx-web has the identical switch in `packages/config/src/site.ts`. **They
 * have to be flipped together.** Flipping one leaves half the product linking
 * to URLs that are about to 301, which is survivable, and the other half
 * linking to a host that does not answer yet, which is not.
 *
 * Two repos, two deploys, one decision. Flip web first (it owns the
 * redirects), confirm, then this one.
 */
export const DOCS_MODE: "inline" | "split" =
  (process.env.NEXT_PUBLIC_DOCS_MODE as "inline" | "split") ?? "inline";

const DOCS_PREFIX = { inline: "/guides", split: "/cli" } as const;
const DOCS_ORIGIN = { inline: HOSTS.web, split: HOSTS.docs } as const;

/**
 * Link to a documentation page by its stable slug.
 *
 *   docsUrl()                           → https://www.evnx.dev/guides
 *   docsUrl("reference/cloud-architecture")
 *     → https://www.evnx.dev/guides/reference/cloud-architecture   (inline)
 *     → https://docs.evnx.dev/cli/reference/cloud-architecture      (split)
 *
 * ⚠️ Always absolute. Docs are a different origin from this app in both modes,
 * and they must never become a route inside the product.
 *
 * ⚠️ Do not hand this "/docs". That path is a *temporary* redirect to
 * `/guides` in evnx-web's next.config.js, and the four links this function
 * replaced all went through it — an extra hop on every click, and a URL that
 * changes twice instead of once.
 */
export function docsUrl(slug = ""): string {
  const clean = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const prefix = DOCS_PREFIX[DOCS_MODE];
  return `${DOCS_ORIGIN[DOCS_MODE]}${clean ? `${prefix}/${clean}` : prefix}`;
}

/** Link to a page on the marketing site. */
export function webUrl(path = "/"): string {
  return `${HOSTS.web}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Documentation slugs this app links to, named once so they cannot drift. */
export const DOCS = {
  home: "",
  cloudArchitecture: "reference/cloud-architecture",
  quickStart: "getting-started/quick-start",
} as const;
