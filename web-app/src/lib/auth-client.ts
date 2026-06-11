export interface CurrentUser {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "standard";
  status: "active" | "disabled";
}

interface LoginResponse {
  user: CurrentUser;
}

const API_BASE = "/api";

async function parseError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return new Error(body.detail || "请求失败");
}

export async function login(
  username: string,
  password: string,
): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as LoginResponse;
  return data.user;
}

export async function logout(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export function buildLoginUrl(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function isSafeNext(value: string | null): value is string {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}
