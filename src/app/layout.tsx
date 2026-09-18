import type { Metadata } from "next";
import { QueryProvider } from "@/lib/api/query-provider";
import { ThemeScript } from "@/components/shell/theme-toggle";
import "./globals.css";
import { IBM_Plex_Mono, Fraunces } from "next/font/google";
import { cn } from "@/lib/utils";

// Self-hosted at build time by next/font — which matters, because the CSP is
// `font-src 'self'` and a Google Fonts <link> would be blocked SILENTLY,
// falling back to system sans with no error anywhere.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "evnx",
  description:
    "Zero-knowledge encrypted sync for .env files. Your secrets are encrypted in this browser — the server only ever holds ciphertext.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required, not cosmetic. ThemeScript sets
    // data-theme on this element BEFORE React hydrates, so the server HTML and
    // the client DOM legitimately differ on exactly that attribute. React
    // otherwise reports a mismatch it says it "won't patch up", which is both
    // alarming and untrue — the attribute is correct; React simply did not put
    // it there. The suppression is scoped to this one element.
    <html
      lang="en"
      className={cn(mono.variable, display.variable)}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
