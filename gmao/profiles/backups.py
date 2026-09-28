import io
import json
import zipfile
from datetime import datetime, timezone

from django.core import serializers
from django.http import HttpResponse, JsonResponse

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


@require_authenticated_user
def backup_export(request):
    try:
        assert_manage_users(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "backup_denied", "detail": str(error)}, status=403)
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)

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
            "exportedBy": request.gmao_profile.email,
            "rowCounts": row_counts,
        }
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    record_audit(
        request, "backup_export", "database",
        details={"tables": sorted(row_counts), "rowCounts": row_counts},
    )

    filename = f"gmao-backup-{exported_at.strftime('%Y%m%dT%H%M%SZ')}.zip"
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
