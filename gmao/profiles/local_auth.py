import json
import hashlib
from functools import lru_cache
from datetime import datetime, timezone
import urllib.error
import urllib.request

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password as django_validate_password
from django.core import signing
from django.core.exceptions import ValidationError
from django.db import transaction

from login_guard.models import PasswordHistory
from .models import LocalCredential, UserProfile
from .services import ProfileAccessError, load_active_profile


TOKEN_SALT = "gmao-local-auth-v1"


class LocalAuthenticationError(Exception):
    pass


class PasswordCompromiseCheckUnavailable(Exception):
    pass


PASSWORD_HISTORY_SIZE = 5


def parse_payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def validate_password(value: object) -> str:
    password = str(value or "")
    django_validate_password(password)
    if settings.GMAO_PWNED_PASSWORD_CHECK:
        _assert_password_not_compromised(password)
    return password


@lru_cache(maxsize=256)
def _fetch_pwned_range(prefix: str) -> str:
    request = urllib.request.Request(
        f"https://api.pwnedpasswords.com/range/{prefix}",
        headers={
            "Accept": "text/plain",
            "Add-Padding": "true",
            "User-Agent": "GMAO-ORDC/password-policy",
        },
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=settings.GMAO_PWNED_PASSWORD_TIMEOUT_SECONDS,
        ) as response:
            return response.read(200_000).decode("ascii")
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as error:
        raise PasswordCompromiseCheckUnavailable(
            "La vérification de sécurité du mot de passe est temporairement indisponible. Réessayez."
        ) from error


def _assert_password_not_compromised(password: str) -> None:
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    prefix, expected_suffix = digest[:5], digest[5:]
    for line in _fetch_pwned_range(prefix).splitlines():
        suffix, separator, count = line.partition(":")
        if separator and suffix == expected_suffix and count != "0":
            raise ValidationError(
                "Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre."
            )


def _assert_password_not_reused(profile_id, password: str, current_hash: str) -> None:
    hashes = [current_hash]
    hashes.extend(
        PasswordHistory.objects.filter(profile_id=profile_id)
        .order_by("-created_at", "-id")
        .values_list("password_hash", flat=True)[:PASSWORD_HISTORY_SIZE]
    )
    if any(check_password(password, password_hash) for password_hash in hashes):
        raise ValidationError(
            "Ce mot de passe a déjà été utilisé récemment. Choisissez-en un autre."
        )


def _replace_password(credential: LocalCredential, password: str) -> None:
    _assert_password_not_reused(credential.profile_id, password, credential.password_hash)
    PasswordHistory.objects.create(
        profile_id=credential.profile_id,
        password_hash=credential.password_hash,
    )
    credential.password_hash = make_password(password)
    credential.must_change_password = False
    credential.password_changed_at = datetime.now(timezone.utc)
    credential.save(
        update_fields=["password_hash", "must_change_password", "password_changed_at", "updated_at"]
    )
    stale_ids = list(
        PasswordHistory.objects.filter(profile_id=credential.profile_id)
        .order_by("-created_at", "-id")
        .values_list("id", flat=True)[PASSWORD_HISTORY_SIZE:]
    )
    if stale_ids:
        PasswordHistory.objects.filter(id__in=stale_ids).delete()


@transaction.atomic
def set_local_password(profile_id, password: object) -> None:
    password = validate_password(password)
    credential = LocalCredential.objects.select_for_update().filter(profile_id=profile_id).first()
    if credential:
        _replace_password(credential, password)
        return
    LocalCredential.objects.create(
        profile_id=profile_id,
        password_hash=make_password(password),
        must_change_password=False,
        password_changed_at=datetime.now(timezone.utc),
    )




def authenticate(email: object, password: object):
    normalized_email = str(email or "").strip().lower()
    try:
        profile = UserProfile.objects.get(email__iexact=normalized_email, active=True)
        credential = LocalCredential.objects.get(profile_id=profile.id)
    except (UserProfile.DoesNotExist, LocalCredential.DoesNotExist) as error:
        raise LocalAuthenticationError("Adresse e-mail ou mot de passe incorrect.") from error
    if not check_password(str(password or ""), credential.password_hash):
        raise LocalAuthenticationError("Adresse e-mail ou mot de passe incorrect.")
    try:
        return load_active_profile(str(profile.id)), credential
    except ProfileAccessError as error:
        raise LocalAuthenticationError(str(error)) from error


def issue_token(profile: UserProfile) -> str:
    return signing.dumps({"sub": str(profile.id)}, salt=TOKEN_SALT, compress=True)


def profile_from_token(token: str) -> UserProfile:
    try:
        payload = signing.loads(token, salt=TOKEN_SALT, max_age=settings.GMAO_LOCAL_TOKEN_MAX_AGE)
        return load_active_profile(payload["sub"])
    except (signing.BadSignature, KeyError, ProfileAccessError) as error:
        raise LocalAuthenticationError("Session locale invalide ou expirée.") from error


@transaction.atomic
def change_password(profile: UserProfile, current_password: object, new_password: object) -> None:
    try:
        credential = LocalCredential.objects.select_for_update().get(profile_id=profile.id)
    except LocalCredential.DoesNotExist as error:
        raise LocalAuthenticationError("Aucun mot de passe local n’est défini pour ce compte.") from error
    if not check_password(str(current_password or ""), credential.password_hash):
        raise LocalAuthenticationError("Le mot de passe actuel est incorrect.")
    new_password = validate_password(new_password)
    _replace_password(credential, new_password)
