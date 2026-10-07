from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import JsonResponse

from login_guard.models import AuditLog

from .audit import _date_parameter
from .permissions import assert_view_audit_log
from .views import require_authenticated_user


KINDS = {"rh_reading_create": "create", "rh_reading_update": "update", "record_delete": "delete"}
READING_RESOURCE = "releves-rh-ge"


def _serialize(entry):
    old = entry.details.get("old") or {}
    new = entry.details.get("new") or {}
    reading = new or old
    return {
        "id": entry.id,
        "createdAt": entry.created_at.isoformat(),
        "actorEmail": entry.actor_email,
        "kind": KINDS[entry.action],
        "site": reading.get("site", ""),
        "groupeCode": reading.get("groupeCode", ""),
        "periode": reading.get("periode", ""),
        "oldRh": old.get("rhActuel"),
        "newRh": new.get("rhActuel"),
        "oldCommentaires": old.get("commentaires", ""),
        "newCommentaires": new.get("commentaires", ""),
    }


@require_authenticated_user
def rh_history_collection(request):
    """Historique des relevés RH (création, correction, suppression), réservé à l'Administrateur."""
    try:
        assert_view_audit_log(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "rh_history_denied", "detail": str(error).replace("Le journal d’audit", "L’historique RH")}, status=403)
    if request.method != "GET":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        limit = min(max(int(request.GET.get("limit", "50")), 1), 100)
        offset = max(int(request.GET.get("offset", "0")), 0)
        # Les suppressions antérieures à l'historique n'ont pas conservé la valeur : elles sont ignorées.
        queryset = AuditLog.objects.filter(
            Q(action__in=("rh_reading_create", "rh_reading_update"))
            | Q(action="record_delete", target_type=READING_RESOURCE, details__has_key="old")
        )
        for parameter, key in (("site", "site"), ("group", "groupeCode")):
            if wanted := request.GET.get(parameter, "").strip():
                queryset = queryset.filter(
                    Q(**{f"details__{key}": wanted}) | Q(**{f"details__old__{key}": wanted}) | Q(**{f"details__new__{key}": wanted})
                )
        if start := _date_parameter(request, "from"):
            queryset = queryset.filter(created_at__date__gte=start)
        if end := _date_parameter(request, "to"):
            queryset = queryset.filter(created_at__date__lte=end)
        total = queryset.count()
        items = [_serialize(entry) for entry in queryset[offset:offset + limit]]
        return JsonResponse({"items": items, "total": total, "limit": limit, "offset": offset})
    except (TypeError, ValueError, ValidationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 400, "code": "rh_history_filter_rejected", "detail": detail}, status=400)
