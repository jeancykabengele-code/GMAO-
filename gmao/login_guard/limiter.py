from dataclasses import dataclass
from datetime import timedelta
from ipaddress import ip_address, ip_network
from math import ceil
from random import uniform
from time import sleep

from django.conf import settings
from django.db import OperationalError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .models import LoginBucket


WINDOW_SECONDS = 15 * 60
PAIR_LIMIT = 5
IP_LIMIT = 50


def client_address(request):
    # Never trust client-supplied X-Forwarded-For. Render's Cloudflare edge
    # overwrites CF-Connecting-IP. Outside Render, use the socket address.
    value = request.META.get("REMOTE_ADDR", "")
    if settings.GMAO_LOGIN_TRUST_RENDER_PROXY:
        value = request.headers.get("CF-Connecting-IP", "")
    try:
        address = ip_address(value)
        if address.version == 6 and address.ipv4_mapped:
            address = address.ipv4_mapped
        # Group an IPv6 /64 to prevent easy bypass by rotating interface IDs.
        return str(ip_network(f"{address}/64", strict=False)) if address.version == 6 else str(address)
    except ValueError:
        # A missing/invalid trusted header shares a restrictive bucket instead
        # of falling back to a spoofable header or bypassing the limiter.
        return "unknown"


def bucket_key(scope, value):
    return salted_hmac(f"gmao-login-{scope}", value, algorithm="sha256").hexdigest()


@dataclass(frozen=True)
class Admission:
    retry_after: int
    scope: str
    key: str


def _load_locked(key, now):
    bucket, _ = LoginBucket.objects.select_for_update().get_or_create(
        key=key, defaults={"window_started": now, "next_allowed": now},
    )
    if now >= bucket.window_started + timedelta(seconds=WINDOW_SECONDS):
        bucket.window_started = now
        bucket.attempts = 0
        bucket.next_allowed = now
    return bucket


def _retry_after(bucket, limit, now):
    deadline = (bucket.window_started + timedelta(seconds=WINDOW_SECONDS)
                if bucket.attempts >= limit else bucket.next_allowed)
    return max(0, ceil((deadline - now).total_seconds()))


def reserve_attempt(request, email):
    # InnoDB may deadlock when simultaneous requests create the same missing
    # bucket. Retry the whole rolled-back transaction, never a partial update.
    for attempt in range(5):
        try:
            return _reserve_attempt(request, email)
        except OperationalError as error:
            if not error.args or error.args[0] != 1213 or attempt == 4:
                raise
            sleep(uniform(0.005, 0.025) * 2 ** attempt)


def _reserve_attempt(request, email):
    address = client_address(request)
    normalized_email = str(email or "").strip().lower()
    ip_key = bucket_key("ip", address)
    pair_key = bucket_key("pair", f"{address}\n{normalized_email}")
    # Reserve BEFORE password verification, including successful attempts.
    # Concurrent requests cannot all pass a read-then-increment check.
    # All workers/instances lock the IP first, then the pair, in this order.
    with transaction.atomic():
        now = timezone.now()
        ip_bucket = _load_locked(ip_key, now)
        # The IP bucket has no progressive delay. Another request may have
        # created it a few microseconds after this request sampled its clock.
        retry = _retry_after(ip_bucket, IP_LIMIT, now) if ip_bucket.attempts >= IP_LIMIT else 0
        if retry:
            return Admission(retry, "ip", ip_key)
        pair_bucket = _load_locked(pair_key, now)
        retry = _retry_after(pair_bucket, PAIR_LIMIT, now)
        if retry:
            return Admission(retry, "pair", pair_key)
        ip_bucket.attempts += 1
        pair_bucket.attempts += 1
        pair_bucket.next_allowed = now + timedelta(seconds=2 ** (pair_bucket.attempts - 1))
        ip_bucket.save()
        pair_bucket.save()
    return Admission(0, "pair", pair_key)
