from __future__ import annotations

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import settings


def create_access_token(subject: str, role: str) -> str:
    """Return a signed JWT with subject and role claims."""
    expire = datetime.now(timezone.utc) + timedelta(hours=24)
    to_encode = {
        "sub": subject,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, str]:
    """Return JWT claims or raise an HTTP 401-compatible error."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        sub: str | None = payload.get("sub")
        role: str | None = payload.get("role")
        if sub is None or role is None:
            raise ValueError("Invalid token claims")
        return {"sub": sub, "role": role}
    except (JWTError, ValueError) as e:
        raise ValueError("Invalid or expired token") from e
