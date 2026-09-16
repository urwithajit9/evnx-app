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

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    if (error.response?.status === 401 && original && !original._retried) {
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

/** 409 on push. Requires re-encryption at the new version — never a plain retry. */
export const CODE_VERSION_CONFLICT = "VERSION_CONFLICT";
