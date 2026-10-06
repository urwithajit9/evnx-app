"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client is shared across
  // every render pass and, in a prerendered build, across requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // ⚠️ **`networkMode` stays at its default (`"online"`) — do not set
            // `"always"` without reading this.**
            //
            // It was briefly set to `"always"` on 2026-10-06 to fix a stall that
            // turned out not to exist. A failing query appeared to sit at
            // `{status: "pending", fetchStatus: "paused"}` forever, so error
            // branches looked unreachable. The cause was the TEST ENVIRONMENT:
            // the page was rendering in a hidden, unfocused tab, and
            // `retryer.ts` pauses on exactly that —
            //
            //     canContinue = () => focusManager.isFocused() && …
            //
            // — so a background tab does not hammer a failing server. In a
            // focused tab the query retries and reaches `isError` in ~3s, which
            // was then verified both ways against query-core 5.102.8 directly.
            //
            // The default is the better behaviour: offline pauses and resumes
            // by itself, where `"always"` would show an error card that needs a
            // manual retry for a condition the offline banner already explains.
            staleTime: 30_000,
            // Decrypting costs real CPU. Refetching because a window regained
            // focus would re-run it for no new information.
            refetchOnWindowFocus: false,
            retry: (count, error) => {
              // Never retry auth failures — the interceptor already tried a
              // refresh, so a second 401 means the session is genuinely gone.
              const status = (error as { response?: { status?: number } })
                ?.response?.status;
              if (status === 401 || status === 403) return false;
              return count < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
