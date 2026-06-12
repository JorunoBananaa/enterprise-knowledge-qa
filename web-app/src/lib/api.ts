import { buildLoginUrl } from "./auth-client";

const API_BASE = "/api";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;

  // fire-and-forget clear the stale cookie before redirecting
  fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    /* ignore */
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

// ── SSE streaming ──────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "chunk"; text: string }
  | { type: "citation"; document_id: number; chunk_id: number; locator: string }
  | { type: "done"; status: string; session_id?: number; message_id?: number }
  | { type: "error"; message: string };

export async function* apiFetchStream(
  path: string,
  options: RequestInit = {},
): AsyncGenerator<StreamEvent, void, undefined> {
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

  if (!res.body) {
    throw new Error("SSE 响应没有 body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          if (currentEvent && raw) {
            try {
              const data = JSON.parse(raw);
              yield { type: currentEvent, ...data } as StreamEvent;
            } catch {
              // Malformed JSON — skip
            }
          }
          currentEvent = "";
        }
        // Empty lines are SSE frame separators — ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}
