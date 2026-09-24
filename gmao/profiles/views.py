from functools import wraps
import logging
from time import perf_counter

from django.core.exceptions import ValidationError
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .local_auth import LocalAuthenticationError, authenticate, change_password, issue_token, parse_payload, profile_from_token
from .permissions import build_permissions


logger = logging.getLogger(__name__)


def health(request):
    return JsonResponse({"status": "UP"})


def database_health(request):
    started_at = perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
            cursor.fetchone()
            table_names = (
                "user_profiles", "sites", "gmao_local_credentials",
                "gmao_equipements", "gmao_tickets",
                "gmao_groupes_electrogenes", "gmao_releves_rh_ge", "gmao_fuel_ge",
                "gmao_fuel_ravitaillements", "gmao_consommations_groupes_ge",
                "gmao_fuel_monthly_summary", "gmao_pue", "gmao_problemes_datacenter",
                "gmao_interventions", "gmao_pieces_rechange", "gmao_notifications",
            )
            records = {}
            table_errors = {}
            for table_name in table_names:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {connection.ops.quote_name(table_name)}")
                    records[table_name] = cursor.fetchone()[0]
                except Exception as error:
                    table_errors[table_name] = str(error)
    except Exception:
        logger.exception("Le controle de connexion MySQL a echoue")
        return JsonResponse({"status": "DOWN", "database": "DOWN"}, status=503)
    elapsed_ms = round((perf_counter() - started_at) * 1000)
    status = "UP" if not table_errors else "DEGRADED"
    return JsonResponse({"status": status, "database": "UP", "responseTimeMs": elapsed_ms, "records": records, "tableErrors": table_errors})


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
def local_login(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = parse_payload(request)
        profile, credential = authenticate(data.get("email"), data.get("password"))
        return JsonResponse({"accessToken": issue_token(profile), "profile": _serialize_profile(profile), "mustChangePassword": False})
    except (ValidationError, LocalAuthenticationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 401, "code": "local_login_rejected", "detail": detail}, status=401)


@require_authenticated_user
def local_change_password(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = parse_payload(request)
        change_password(request.gmao_profile, data.get("currentPassword"), data.get("newPassword"))
        return JsonResponse({"status": "changed"})
    except (ValidationError, LocalAuthenticationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 400, "code": "password_change_rejected", "detail": detail}, status=400)


@require_authenticated_user
def current_user(request):
    return JsonResponse(_serialize_profile(request.gmao_profile))
