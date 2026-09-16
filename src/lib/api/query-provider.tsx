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
