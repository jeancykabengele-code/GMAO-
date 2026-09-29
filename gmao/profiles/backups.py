import io
import json
import zipfile
from datetime import datetime, timezone

from django.conf import settings
from django.core import serializers
from django.http import HttpResponse, JsonResponse
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from login_guard.models import AuditLog

from .audit import record_audit
from .models import (
    DatacenterProblem,
    Equipment,
    FuelDelivery,
    FuelMonthlySummary,
    FuelRecord,
    GeneratorFuelConsumption,
    GeneratorMonthlyReading,
    GeneratorRecord,
    Intervention,
    Notification,
    PueRecord,
    Site,
    SparePartOperation,
    Ticket,
    UserProfile,
)
from .permissions import assert_manage_users
from .views import require_authenticated_user


# LocalCredential (password hashes) and PasswordHistory/LoginBucket (internal
# rate-limiting state) are deliberately excluded: they hold no business data
# and must never leave the database, even in an administrator-triggered export.
BACKUP_MODELS = (
    Site,
    UserProfile,
    Equipment,
    Ticket,
    GeneratorRecord,
    GeneratorMonthlyReading,
    FuelRecord,
    FuelDelivery,
    GeneratorFuelConsumption,
    FuelMonthlySummary,
    PueRecord,
    DatacenterProblem,
    Intervention,
    SparePartOperation,
    Notification,
    AuditLog,
)


def _build_backup_archive(exported_by: str) -> tuple[bytes, dict, str]:
    row_counts = {}
    buffer = io.BytesIO()
    # In-memory ZIP: the production host has no persistent disk, so the
    # archive is generated and streamed back in a single request, never
    # written to the container filesystem.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for model in BACKUP_MODELS:
            table = model._meta.db_table
            queryset = model.objects.all()
            row_counts[table] = queryset.count()
            archive.writestr(f"{table}.json", serializers.serialize("json", queryset))
        exported_at = datetime.now(timezone.utc)
        manifest = {
            "exportedAt": exported_at.isoformat(),
            "exportedBy": exported_by,
            "rowCounts": row_counts,
        }
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    filename = f"gmao-backup-{exported_at.strftime('%Y%m%dT%H%M%SZ')}.zip"
    return buffer.getvalue(), row_counts, filename


def _backup_response(content: bytes, filename: str) -> HttpResponse:
    response = HttpResponse(content, content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@require_authenticated_user
def backup_export(request):
    try:
        assert_manage_users(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "backup_denied", "detail": str(error)}, status=403)
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)

    content, row_counts, filename = _build_backup_archive(request.gmao_profile.email)
    record_audit(
        request, "backup_export", "database",
        details={"tables": sorted(row_counts), "rowCounts": row_counts},
    )
    return _backup_response(content, filename)


@csrf_exempt
@never_cache
@require_POST
def scheduled_backup_export(request):
    """Sauvegarde hebdomadaire déclenchée par un workflow GitHub Actions planifié.

    Authentifiée par un jeton dédié (jamais une session utilisateur) car il
    n'y a personne pour se connecter un dimanche à 3h du matin.
    """
    expected_token = settings.GMAO_BACKUP_TOKEN
    scheme, separator, token = request.headers.get("Authorization", "").partition(" ")
    if (not expected_token or not separator or scheme.lower() != "bearer"
            or not constant_time_compare(token, expected_token)):
        response = JsonResponse({"detail": "Accès non autorisé."}, status=401)
        response["WWW-Authenticate"] = "Bearer"
        return response

    content, row_counts, filename = _build_backup_archive("scheduled-backup")
    record_audit(
        request, "backup_export", "database",
        actor_email="scheduled-backup",
        details={"tables": sorted(row_counts), "rowCounts": row_counts, "scheduled": True},
    )
    return _backup_response(content, filename)
