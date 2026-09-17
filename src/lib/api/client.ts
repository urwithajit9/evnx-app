/**
 * API client for evnx-server.
 *
 * The browser talks to `api.evnx.dev` directly — there is no proxy, because a
 * zero-knowledge app has nothing for a proxy to usefully do. Every request that
 * matters carries ciphertext the intermediary could not read anyway.
 */

"use client";

import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.evnx.dev";

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  // No cookies. The server issues none — tokens come back in the JSON body, the
  // same way the CLI consumes them — so `withCredentials` would be noise.
  withCredentials: false,
});

/**
 * Access and refresh tokens.
 *
 * Module scope, not `localStorage`. An access token is not a secret in the way a
 * key is, but it is a bearer credential, and putting bearer credentials in
 * `localStorage` hands them to any XSS that lands. Memory means a reload signs
 * the user out — which is correct here anyway, because the master key is gone on
 * reload too and no token can substitute for it.
 */
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

export function hasSession() {
  return accessToken !== null;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// ─── Refresh, serialised ─────────────────────────────────────────────────────
//
// Several requests can 401 at once when a 15-minute access token expires. Without
// a shared in-flight promise each would refresh independently, and because the
// server *rotates* refresh tokens, all but one would present an already-spent
// token and fail — signing the user out mid-session for no reason.
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshToken) throw new Error("no refresh token");

  refreshing ??= axios
    .post(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refreshToken })
    .then((r) => {
      setTokens(r.data.access_token, r.data.refresh_token);
      return r.data.access_token as string;
    })
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

/**
 * Endpoints where a 401 means "these credentials are wrong", not "your access
 * token expired".
 *
 * Refreshing on one of these is worse than useless. The server **rotates**
 * refresh tokens, so a failed sign-in attempt would spend the refresh token
 * belonging to a perfectly good existing session, retry the login with an
 * `Authorization` header that means nothing to it, 401 again, and then clear the
 * tokens — signing the user out because someone mistyped a password.
 *
 * `/auth/refresh` is listed for completeness; it is issued with bare `axios`
 * rather than this instance, so it could not recurse anyway.
 */
const UNAUTHENTICATED_PATHS = [
  "/auth/register",
  "/auth/srp/init",
  "/auth/srp/verify",
  "/auth/totp/verify",
  "/auth/refresh",
  "/auth/verify-email",
  "/auth/resend-verification",
];

function isUnauthenticatedPath(url: string | undefined): boolean {
  if (!url) return false;
  // Compare on the path only: `url` here is whatever was passed to the call,
  // which may be relative to `baseURL` or absolute.
  return UNAUTHENTICATED_PATHS.some((p) => url.endsWith(p));
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isUnauthenticatedPath(original.url)
    ) {
      original._retried = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        clearTokens();
      }
    }

    return Promise.reject(error);
  },
);

/**
 * The server's error shape: `{ error, code }`.
 *
 * Branch on `code`, never on the message — the message is written for humans and
 * will change. `code` is the contract.
 */
export type ApiError = { error: string; code: string };

export function apiErrorCode(e: unknown): string | null {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as ApiError | undefined;
    return data?.code ?? null;
  }
  return null;
}

/**
 * HTTP status, for the cases where it carries meaning the `code` does not.
 *
 * Mostly this should be `apiErrorCode`. The exception that matters is **401 vs
 * 403 on vault routes**: those sit behind `require_verified`, so an
 * authenticated-but-unverified account is refused with 403. Collapsing the two
 * into "please sign in" sends someone to re-enter a password that was never the
 * problem, when what they need is to open an email.
 */
export function apiErrorStatus(e: unknown): number | null {
  return axios.isAxiosError(e) ? (e.response?.status ?? null) : null;
}

/** 409 on push. Requires re-encryption at the new version — never a plain retry. */
export const CODE_VERSION_CONFLICT = "VERSION_CONFLICT";
