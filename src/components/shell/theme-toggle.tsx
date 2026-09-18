/**
 * Light / dark switch.
 *
 * ─── Dark is the default, and not because of a system preference ─────────────
 *
 * `evnx.dev` is dark-only. A dashboard that silently followed the OS would put
 * a light app next to a dark marketing site for everyone on a light desktop,
 * which is the divergence the design system exists to prevent. So dark is the
 * default for everybody, and light is a deliberate choice that is remembered.
 *
 * ─── Why `localStorage` is the right store here ──────────────────────────────
 *
 * Normally this app keeps nothing in browser storage — tokens live in module
 * scope and keys live in the Worker, because both are credentials. A theme is
 * not. It reveals nothing, it is per-device by nature, and the alternative —
 * a server round trip — would make the choice vanish until after sign-in.
 *
 * ⚠️ Every read and write is guarded. `localStorage` throws outright in some
 * contexts (a private window with site data blocked, an embedded webview), and
 * an exception here would take the whole header down with it.
 */

"use client";

import { useSyncExternalStore } from "react";

export const THEME_KEY = "evnx-theme";
type Theme = "dark" | "light";

/**
 * The theme is genuinely an EXTERNAL store — it lives on the `<html>` element,
 * put there by the inline script below before React exists. `useSyncExternalStore`
 * is the hook for exactly that, and using it instead of `useState` in an effect
 * buys three things:
 *
 *   * no `setState` inside an effect, which is both a lint error and an extra
 *     render pass;
 *   * the correct value on the very first client render, since the attribute is
 *     already set — so no flash and no wrong icon;
 *   * **cross-tab sync**, because `subscribe` listens for `storage` events. Two
 *     open tabs now agree, which they would not with local component state.
 */
function subscribe(onChange: () => void) {
  // `storage` fires in OTHER tabs when this one writes — that is the whole point.
  window.addEventListener("storage", onChange);
  // And an observer for this tab, since setAttribute fires no event.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    window.removeEventListener("storage", onChange);
    observer.disconnect();
  };
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

/** During prerender there is no document. Dark is the default, so dark it is. */
function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function apply(next: Theme) {
    // Dark is the default, so it is expressed by the ABSENCE of the attribute —
    // which keeps `:root` alone as the canonical block rather than needing a
    // `[data-theme="dark"]` that duplicates it.
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage refused — a private window, or site data blocked. The theme
      // still applies to this page; it simply will not be remembered. A
      // degraded convenience, not a broken page.
    }
  }

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-overlay)] hover:text-foreground"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/**
 * Applied before first paint.
 *
 * Without this the page renders dark, React hydrates, and only then does the
 * stored choice apply — a visible flash on every load for anyone who chose
 * light. It has to be a blocking inline script in `<head>`; there is no
 * React-shaped way to run code before the first paint.
 *
 * The CSP permits it: `script-src` includes `'unsafe-inline'`, which Next's own
 * hydration bootstrap already requires.
 */
export function ThemeScript() {
  const js = `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" strokeLinejoin="round" />
    </svg>
  );
}
