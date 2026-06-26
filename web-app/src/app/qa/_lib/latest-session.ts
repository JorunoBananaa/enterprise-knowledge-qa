interface SessionLike {
  id: number;
  created_at: string;
}

function getSessionTime(session: SessionLike): number {
  const time = Date.parse(session.created_at);
  return Number.isFinite(time) ? time : 0;
}

export function getLatestSession<T extends SessionLike>(
  sessions: readonly T[],
): T | null {
  if (sessions.length === 0) return null;

  return sessions.reduce((latest, session) => {
    const currentTime = getSessionTime(session);
    const latestTime = getSessionTime(latest);

    if (currentTime > latestTime) return session;
    if (currentTime === latestTime && session.id > latest.id) return session;
    return latest;
  });
}
