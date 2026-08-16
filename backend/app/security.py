from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from fastapi import Response
from pwdlib import PasswordHash

from .config import get_settings

SESSION_COOKIE = "acqr_session"
CSRF_COOKIE = "acqr_csrf"
CSRF_HEADER = "X-CSRF-Token"
password_hash = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = password_hash.hash("ACCORSI-dummy-password-never-used-2026!")


def hash_secret(value: str) -> str:
    secret = get_settings().session_secret.encode("utf-8")
    return hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()


def create_token() -> str:
    return secrets.token_urlsafe(48)


def hash_password(value: str) -> str:
    return password_hash.hash(value)


def verify_password(value: str, encoded: str) -> bool:
    try:
        return password_hash.verify(value, encoded)
    except (ValueError, TypeError):
        return False


def session_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(hours=get_settings().session_hours)


def set_auth_cookies(
    response: Response,
    *,
    session_token: str,
    csrf_token: str,
) -> None:
    settings = get_settings()
    max_age = settings.session_hours * 60 * 60
    common = {
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain,
        "path": "/",
        "max_age": max_age,
    }
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        httponly=True,
        **common,
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        httponly=False,
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    common = {
        "domain": settings.cookie_domain,
        "path": "/",
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
    }
    response.delete_cookie(SESSION_COOKIE, httponly=True, **common)
    response.delete_cookie(CSRF_COOKIE, httponly=False, **common)


class LoginThrottle:
    def __init__(self) -> None:
        self._attempts: dict[str, deque[datetime]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, key: str, now: datetime) -> deque[datetime]:
        settings = get_settings()
        cutoff = now - timedelta(minutes=settings.login_window_minutes)
        attempts = self._attempts[key]
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        return attempts

    def allowed(self, key: str) -> bool:
        with self._lock:
            attempts = self._trim(key, datetime.now(UTC))
            return len(attempts) < get_settings().login_max_attempts

    def record_failure(self, key: str) -> None:
        with self._lock:
            attempts = self._trim(key, datetime.now(UTC))
            attempts.append(datetime.now(UTC))

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


login_throttle = LoginThrottle()
