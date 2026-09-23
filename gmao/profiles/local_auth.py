import json
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core import signing
from django.core.exceptions import ValidationError

from .models import LocalCredential, UserProfile
from .services import ProfileAccessError, load_active_profile


TOKEN_SALT = "gmao-local-auth-v1"


class LocalAuthenticationError(Exception):
    pass


def parse_payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def validate_temporary_password(value: object) -> str:
    password = str(value or "")
    if len(password) < 12:
        raise ValidationError("Le mot de passe temporaire doit contenir au moins 12 caractères.")
    return password


def set_temporary_password(profile_id, password: object) -> None:
    password = validate_temporary_password(password)
    LocalCredential.objects.update_or_create(
        profile_id=profile_id,
        defaults={"password_hash": make_password(password), "must_change_password": True, "password_changed_at": None},
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


def change_password(profile: UserProfile, current_password: object, new_password: object) -> None:
    new_password = validate_temporary_password(new_password)
    try:
        credential = LocalCredential.objects.get(profile_id=profile.id)
    except LocalCredential.DoesNotExist as error:
        raise LocalAuthenticationError("Aucun mot de passe local n’est défini pour ce compte.") from error
    if not check_password(str(current_password or ""), credential.password_hash):
        raise LocalAuthenticationError("Le mot de passe actuel est incorrect.")
    credential.password_hash = make_password(new_password)
    credential.must_change_password = False
    credential.password_changed_at = datetime.now(timezone.utc)
    credential.save(update_fields=["password_hash", "must_change_password", "password_changed_at", "updated_at"])
