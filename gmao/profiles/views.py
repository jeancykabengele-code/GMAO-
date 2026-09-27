from functools import wraps
import logging
from time import perf_counter

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from login_guard.limiter import release_successful_attempt, reserve_attempt

from .local_auth import LocalAuthenticationError, PasswordCompromiseCheckUnavailable, authenticate, change_password, issue_token, parse_payload, profile_from_token, revoke_sessions
from .permissions import build_permissions


logger = logging.getLogger(__name__)


def health(request):
    return JsonResponse({"status": "UP"})


@never_cache
@require_GET
def database_health(request):
    expected_token = settings.GMAO_HEALTH_TOKEN
    scheme, separator, token = request.headers.get("Authorization", "").partition(" ")
    if (not expected_token or not separator or scheme.lower() != "bearer"
            or not constant_time_compare(token, expected_token)):
        response = JsonResponse({"detail": "Accès non autorisé."}, status=401)
        response["WWW-Authenticate"] = "Bearer"
        return response

    started_at = perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
            cursor.fetchone()
    except Exception:
        logger.warning("Le controle de connexion a la base a echoue")
        return JsonResponse({"status": "DOWN", "database": "DOWN"}, status=503)
    elapsed_ms = round((perf_counter() - started_at) * 1000)
    return JsonResponse({"status": "UP", "database": "UP", "responseTimeMs": elapsed_ms})


def require_authenticated_user(view):
    """Authentifie toutes les routes API avec un jeton Django signé."""
    @csrf_exempt
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        scheme, separator, token = request.headers.get("Authorization", "").partition(" ")
        if not separator or scheme.lower() != "bearer" or not token.strip():
            return JsonResponse({"status": 401, "code": "missing_bearer_token", "detail": "Jeton de session manquant."}, status=401)
        try:
            request.gmao_profile = profile_from_token(token.strip())
        except LocalAuthenticationError as error:
            return JsonResponse({"status": 401, "code": "invalid_session", "detail": str(error)}, status=401)
        return view(request, *args, **kwargs)
    return wrapped

def _serialize_profile(profile):
    permissions = build_permissions(profile)
    response = {
        "id": str(profile.id), "email": profile.email, "fullName": profile.full_name,
        "role": profile.role, "site": profile.site, "active": profile.active,
        "createdAt": profile.created_at.isoformat() if profile.created_at else None,
        "permissions": permissions.as_dict(),
    }
    response["mustChangePassword"] = False
    return response


@csrf_exempt
@never_cache
def local_login(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = parse_payload(request)
    except (ValidationError, UnicodeDecodeError):
        data = {}
    try:
        admission = reserve_attempt(request, data.get("email"))
    except DatabaseError:
        logger.error("login_limiter_unavailable")
        return JsonResponse({"status": 503, "code": "login_unavailable", "detail": "Connexion temporairement indisponible. Veuillez réessayer."}, status=503)
    if admission.retry_after:
        logger.warning("login_rate_limited scope=%s bucket=%s retry_after=%s", admission.scope, admission.key, admission.retry_after)
        from .audit import record_audit
        record_audit(request, "login", "session", result="blocked", actor_email=str(data.get("email", "")).strip().lower(), details={"reason": "rate_limited", "scope": admission.scope, "retryAfter": admission.retry_after})
        response = JsonResponse({"status": 429, "code": "login_rate_limited", "retryAfter": admission.retry_after, "detail": f"Trop de tentatives de connexion. Réessayez dans {admission.retry_after} secondes."}, status=429)
        response["Retry-After"] = str(admission.retry_after)
        return response
    try:
        profile, _credential = authenticate(data.get("email"), data.get("password"))
    except (ValidationError, LocalAuthenticationError) as error:
        from .audit import record_audit
        record_audit(request, "login", "session", result="failure", actor_email=str(data.get("email", "")).strip().lower(), details={"reason": "invalid_credentials"})
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 401, "code": "local_login_rejected", "detail": detail}, status=401)
    try:
        release_successful_attempt(admission)
    except DatabaseError:
        logger.error("login_limiter_release_unavailable")
        return JsonResponse({"status": 503, "code": "login_unavailable", "detail": "Connexion temporairement indisponible. Veuillez réessayer."}, status=503)
    from .audit import record_audit
    record_audit(request, "login", "session", target_id=getattr(profile, "id", ""), actor=profile, details={"reason": "authenticated"})
    return JsonResponse({"accessToken": issue_token(profile), "profile": _serialize_profile(profile), "mustChangePassword": False})


@require_authenticated_user
def local_logout(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    with transaction.atomic():
        revoke_sessions(request.gmao_profile.id)
        from .audit import record_audit
        record_audit(request, "logout", "session", request.gmao_profile.id, details={"reason": "logout"})
    return JsonResponse({"status": "logged_out"})


@require_authenticated_user
def local_change_password(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = parse_payload(request)
        with transaction.atomic():
            change_password(request.gmao_profile, data.get("currentPassword"), data.get("newPassword"))
            from .audit import record_audit
            record_audit(request, "password_change", "profile", request.gmao_profile.id, details={"scope": "self"})
            access_token = issue_token(request.gmao_profile)
        return JsonResponse({"status": "changed", "accessToken": access_token})
    except (ValidationError, LocalAuthenticationError) as error:
        from .audit import record_audit
        record_audit(request, "password_change", "profile", request.gmao_profile.id, result="failure", details={"scope": "self", "reason": "rejected"})
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 400, "code": "password_change_rejected", "detail": detail}, status=400)
    except PasswordCompromiseCheckUnavailable as error:
        from .audit import record_audit
        record_audit(request, "password_change", "profile", request.gmao_profile.id, result="failure", details={"scope": "self", "reason": "compromise_check_unavailable"})
        return JsonResponse({"status": 503, "code": "password_check_unavailable", "detail": str(error)}, status=503)


@require_authenticated_user
def current_user(request):
    return JsonResponse(_serialize_profile(request.gmao_profile))
