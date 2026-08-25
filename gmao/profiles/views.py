from functools import wraps
from time import perf_counter

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .authentication import SupabaseAuthenticationError, verify_supabase_token
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
    @csrf_exempt
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        scheme, separator, token = authorization.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token.strip():
            return JsonResponse(
                {"status": 401, "code": "missing_bearer_token", "detail": "Jeton Supabase manquant."},
                status=401,
            )
        try:
            request.supabase_claims = verify_supabase_token(token.strip())
        except SupabaseAuthenticationError as error:
            return JsonResponse(
                {"status": 401, "code": "invalid_supabase_token", "detail": str(error)},
                status=401,
            )
        try:
            request.gmao_profile = load_active_profile(request.supabase_claims["sub"])
        except ProfileAccessError as error:
            return JsonResponse(
                {"status": 403, "code": "profile_access_denied", "detail": str(error)},
                status=403,
            )
        return view(request, *args, **kwargs)

    return wrapped


@require_supabase_user
def current_user(request):
    profile = request.gmao_profile
    permissions = build_permissions(profile)
    return JsonResponse(
        {
            "id": str(profile.id),
            "email": profile.email,
            "fullName": profile.full_name,
            "role": profile.role,
            "site": profile.site,
            "active": profile.active,
            "createdAt": profile.created_at.isoformat() if profile.created_at else None,
            "permissions": permissions.as_dict(),
        }
    )