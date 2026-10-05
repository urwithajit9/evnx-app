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
            // ⚠️ **A FAILING QUERY CAN STALL INSTEAD OF FAILING. Observed,
            // reproducible, and not fully explained — read this before adding
            // an error branch and assuming it will render.**
            //
            // With the retry policy below, `/auth/usage` returning 500 left the
            // query at `{status: "pending", fetchStatus: "paused",
            // failureCount: 1}` indefinitely, so `isError` never became true
            // and the card showed a loading skeleton forever. Every other query
            // on the page returned 200 at the same moment.
            //
            // What was ruled out, by measuring rather than reasoning:
            //   • it reproduces in a PRODUCTION build, not just dev;
            //   • `navigator.onLine` and `onlineManager.isOnline()` were both
            //     `true` throughout;
            //   • `networkMode: "always"` did NOT change it, so the documented
            //     pause-when-offline path is not what is happening;
            //   • with `retry: false` the same query errors correctly and the
            //     error branch renders. **The stall is in the retry path.**
            //
            // ⚠️ Only reproduced inside the Claude desktop browser pane so far,
            // so it may be environment-specific. Treat it as real until someone
            // has checked a second browser.
            //
            // `networkMode: "always"` is kept because it is right on its own
            // terms — a failure should be visible as a failure, and the offline
            // banner in `AppShell` is a better answer than a silent pause — but
            // it is NOT a fix for the above.
            networkMode: "always",
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
