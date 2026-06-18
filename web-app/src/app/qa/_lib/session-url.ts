export function buildSessionUrl(href: string, sessionId: number): string {
  const url = new URL(href);
  url.searchParams.set("session_id", String(sessionId));
  return `${url.pathname}${url.search}`;
}

export function pushCurrentSessionUrl(sessionId: number): void {
  window.history.pushState(
    null,
    "",
    buildSessionUrl(window.location.href, sessionId),
  );
}

export function replaceCurrentSessionUrl(sessionId: number): void {
  window.history.replaceState(
    null,
    "",
    buildSessionUrl(window.location.href, sessionId),
  );
}
