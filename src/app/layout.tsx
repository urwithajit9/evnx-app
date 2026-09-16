import type { Metadata } from "next";
import { QueryProvider } from "@/lib/api/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "evnx",
  description:
    "Zero-knowledge encrypted sync for .env files. Your secrets are encrypted in this browser — the server only ever holds ciphertext.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
