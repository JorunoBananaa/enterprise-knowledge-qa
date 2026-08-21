import { buildLoginUrl } from "./auth-client";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "/api").replace(
  /\/+$/,
  "",
);

function resolveStreamApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_STREAM_API_BASE;
  if (configured) return configured.replace(/\/+$/, "");

  if (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  return API_BASE;
}

function buildApiUrl(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildStreamApiUrl(path: string): string {
  return buildApiUrl(resolveStreamApiBase(), path);
}

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;

  // 发起即忘：重定向前先清除可能过期的 cookie
  fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    /* 忽略 */
  });

  window.location.href = buildLoginUrl(currentPath());
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (res.status === 401) {
    redirectToLogin();
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "请求失败");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// ── SSE 流式响应 ─────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "session"; session_id: number }
  | { type: "chunk"; text: string }
  | {
      type: "citation";
      document_id: number | null;
      document_title?: string;
      document_name?: string;
      document_file_type?: string;
      document_path?: string;
      document_category_id?: number;
      chunk_id: number;
      locator: string;
      quoted_text_preview?: string;
      rank?: number;
    }
  | { type: "done"; status: string; session_id?: number; message_id?: number }
  | { type: "error"; message: string };

export async function apiStreamFetch(
  baseURL: Parameters<typeof fetch>[0],
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(baseURL, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      ...headers,
    },
  });

  if (res.status === 401) {
    redirectToLogin();
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "请求失败");
  }

  if (!res.body) {
    throw new Error("SSE 响应没有 body");
  }

  return res;
}
