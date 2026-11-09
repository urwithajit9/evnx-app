/**
 * API client for evnx-server.
 *
 * The browser talks to `api.evnx.dev` directly — there is no proxy, because a
 * zero-knowledge app has nothing for a proxy to usefully do. Every request that
 * matters carries ciphertext the intermediary could not read anyway.
 */

"use client";

import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { noteReachable, noteUnreachable } from "@/lib/online";

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
  (r) => {
    // Something answered, so whatever was in the way is not any more.
    noteReachable();
    return r;
  },
  async (error: AxiosError) => {
    // ⚠️ No `response` at all is the only shape that means "nothing answered".
    // A 500 is the server working and saying so, and treating it as offline
    // would hide a real outage behind a connectivity message.
    if (!error.response) noteUnreachable();

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
 * The server's error shape: `{ error, code }`, and on a 403 sometimes a `reason`.
 *
 * Branch on `code` (and `reason`), never on the message — the message is written
 * for humans and will change. `code` is the contract.
 *
 * ─── 403 and `reason` ────────────────────────────────────────────────────────
 *
 * A 403 is always `code: "FORBIDDEN"`; `reason` says which kind of refusal:
 *
 *   ROLE_TOO_LOW     your role is below `required_role` (vault: viewer |
 *                    developer | admin | owner; org: member | admin | owner)
 *   TOKEN_SCOPE      an API token without the scope this needs
 *   TOKEN_READ_ONLY  a read-only API token tried to write
 *   PLAN_LIMIT       the plan does not allow more of this
 *
 * ⚠️ No `reason` is a generic refusal, not an error — older servers and some
 * refusals never send one. Anything unrecognised is treated the same way, so a
 * reason added server-side later degrades to the server's own sentence instead of
 * to a blank. A non-member gets 404, not 403: the existence of a vault is not
 * disclosed to people who cannot see it.
 */
export type ApiError = {
  error: string;
  code: string;
  reason?: ApiErrorReason;
  required_role?: string;
};

export type ApiErrorReason =
  | "ROLE_TOO_LOW"
  | "TOKEN_SCOPE"
  | "TOKEN_READ_ONLY"
  | "PLAN_LIMIT";

function errorData(e: unknown): Partial<ApiError> | undefined {
  if (!axios.isAxiosError(e)) return undefined;
  return e.response?.data as Partial<ApiError> | undefined;
}

export function apiErrorCode(e: unknown): string | null {
  return errorData(e)?.code ?? null;
}

/** Why a 403 was refused, or null when the server gave no reason. */
export function apiErrorReason(e: unknown): ApiErrorReason | null {
  const reason = errorData(e)?.reason;
  return reason === "ROLE_TOO_LOW" ||
    reason === "TOKEN_SCOPE" ||
    reason === "TOKEN_READ_ONLY" ||
    reason === "PLAN_LIMIT"
    ? reason
    : null;
}

/**
 * A sentence for a failed request, for showing to a person.
 *
 * Most of the time that is the server's own — it writes `error` for people ("all
 * 5 seats are assigned. Release one, or raise the seat count.") — so it is shown
 * as sent. A refusal with a `reason` gets a more specific sentence here, because
 * "forbidden" alone leaves someone guessing whether to ask for a role, upgrade or
 * give up. `fallback` covers everything that has no sentence at all: no network,
 * a proxy's error page, a thrown `Error`. Branch on `apiErrorCode` /
 * `apiErrorReason`, never on this.
 */
export function apiErrorMessage(
  e: unknown,
  fallback = "Something went wrong. Nothing was changed.",
): string {
  const data = errorData(e);
  const sent = data?.error;

  switch (apiErrorReason(e)) {
    case "ROLE_TOO_LOW": {
      // ⚠️ `required_role` is a vault role or an org role, and the reason alone
      // does not say which. Every org route lives under /orgs, so the request URL
      // does.
      const url = axios.isAxiosError(e) ? (e.config?.url ?? "") : "";
      const where = url.startsWith("/orgs") ? "organisation" : "vault";
      const role = data?.required_role;
      return role
        ? `This needs the ${role} role on this ${where}.`
        : (sent ?? `Your role on this ${where} is too low for that.`);
    }
    case "PLAN_LIMIT":
      return `${sent ?? "Your plan's limit is reached."} Upgrade or make room under Billing (/billing/).`;
    case "TOKEN_SCOPE":
      return "This API token does not have the scope for that. Use a token with a wider scope.";
    case "TOKEN_READ_ONLY":
      return "This API token is read-only, so it cannot make changes.";
    default:
      return sent ?? fallback;
  }
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
