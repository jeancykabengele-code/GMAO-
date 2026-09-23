from functools import wraps
from time import perf_counter

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .authentication import SupabaseAuthenticationError, verify_supabase_token
from .local_auth import LocalAuthenticationError, authenticate, change_password, issue_token, parse_payload, profile_from_token
from .models import LocalCredential
from .permissions import build_permissions
from .services import ProfileAccessError, load_active_profile


def health(request):
    return JsonResponse({"status": "UP"})


def database_health(request):
    started_at = perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
            cursor.fetchone()
    except Exception:
        return JsonResponse({"status": "DOWN", "database": "DOWN"}, status=503)
    elapsed_ms = round((perf_counter() - started_at) * 1000)
    return JsonResponse({"status": "UP", "database": "UP", "responseTimeMs": elapsed_ms})


def require_supabase_user(view):
    """Compatibilité transitoire : Supabase par défaut, jeton Django en mode local."""
    @csrf_exempt
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        scheme, separator, token = authorization.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token.strip():
            return JsonResponse({"status": 401, "code": "missing_bearer_token", "detail": "Jeton de session manquant."}, status=401)
        try:
            if settings.GMAO_AUTH_PROVIDER == "django":
                request.gmao_profile = profile_from_token(token.strip())
                if not request.path.endswith("/auth/local/change-password") and LocalCredential.objects.filter(profile_id=request.gmao_profile.id, must_change_password=True).exists():
                    return JsonResponse({"status": 403, "code": "password_change_required", "detail": "Vous devez remplacer votre mot de passe temporaire avant de continuer."}, status=403)
            else:
                request.supabase_claims = verify_supabase_token(token.strip())
                request.gmao_profile = load_active_profile(request.supabase_claims["sub"])
        except (SupabaseAuthenticationError, LocalAuthenticationError) as error:
            return JsonResponse({"status": 401, "code": "invalid_session", "detail": str(error)}, status=401)
        except ProfileAccessError as error:
            return JsonResponse({"status": 403, "code": "profile_access_denied", "detail": str(error)}, status=403)
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
    if settings.GMAO_AUTH_PROVIDER == "django":
        response["mustChangePassword"] = LocalCredential.objects.filter(profile_id=profile.id, must_change_password=True).exists()
    return response


@csrf_exempt
def local_login(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    if settings.GMAO_AUTH_PROVIDER != "django":
        return JsonResponse({"status": 409, "detail": "La connexion locale sera disponible après la bascule Django."}, status=409)
    try:
        data = parse_payload(request)
        profile, credential = authenticate(data.get("email"), data.get("password"))
        return JsonResponse({"accessToken": issue_token(profile), "profile": _serialize_profile(profile), "mustChangePassword": credential.must_change_password})
    except (ValidationError, LocalAuthenticationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 401, "code": "local_login_rejected", "detail": detail}, status=401)


@require_supabase_user
def local_change_password(request):
    if settings.GMAO_AUTH_PROVIDER != "django":
        return JsonResponse({"status": 409, "detail": "Le changement de mot de passe local sera disponible après la bascule Django."}, status=409)
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = parse_payload(request)
        change_password(request.gmao_profile, data.get("currentPassword"), data.get("newPassword"))
        return JsonResponse({"status": "changed"})
    except (ValidationError, LocalAuthenticationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 400, "code": "password_change_rejected", "detail": detail}, status=400)


@require_supabase_user
def current_user(request):
    return JsonResponse(_serialize_profile(request.gmao_profile))
