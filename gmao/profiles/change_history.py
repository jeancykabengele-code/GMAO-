from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import JsonResponse

from login_guard.models import AuditLog

from .audit import _date_parameter
from .permissions import assert_view_audit_log
from .records import RESOURCE_MODELS
from .views import require_authenticated_user


# Les relevés RH ont d'abord été journalisés sous leurs propres actions : elles restent lisibles.
KINDS = {
    "record_create": "create",
    "record_update": "update",
    "record_delete": "delete",
    "rh_reading_create": "create",
    "rh_reading_update": "update",
}
LEGACY_RESOURCE = "releves-rh-ge"
REFERENCE_KEYS = ("code", "numero", "groupeCode", "periode", "mois")
FALLBACK_REFERENCE_KEYS = ("date", "equipement", "nom")


def _reference(reading):
    parts = [str(reading[key]) for key in REFERENCE_KEYS if reading.get(key)]
    if not parts:
        parts = [str(reading[key]) for key in FALLBACK_REFERENCE_KEYS if reading.get(key)][:1]
    return " · ".join(parts)


def _changes(kind, old, new):
    if kind == "update":
        return [{"field": key, "old": old.get(key), "new": new.get(key)} for key in new if old.get(key) != new.get(key)]
    values = new if kind == "create" else old
    return [
        {"field": key, "old": value if kind == "delete" else None, "new": value if kind == "create" else None}
        for key, value in values.items()
        if key != "site" and value not in (None, "")
    ]


def _serialize(entry):
    kind = KINDS[entry.action]
    details = entry.details if isinstance(entry.details, dict) else {}
    old = details.get("old") if isinstance(details.get("old"), dict) else {}
    new = details.get("new") if isinstance(details.get("new"), dict) else {}
    reading = new or old
    return {
        "id": entry.id,
        "createdAt": entry.created_at.isoformat(),
        "actorEmail": entry.actor_email,
        "kind": kind,
        "resource": entry.target_type,
        "site": reading.get("site") or details.get("site", ""),
        "reference": _reference(reading),
        "changes": _changes(kind, old, new),
    }


@require_authenticated_user
def change_history_collection(request):
    """Historique des créations, modifications et suppressions de fiches, réservé à l'Administrateur."""
    try:
        assert_view_audit_log(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "change_history_denied", "detail": str(error).replace("Le journal d’audit", "L’historique des modifications")}, status=403)
    if request.method != "GET":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        limit = min(max(int(request.GET.get("limit", "50")), 1), 100)
        offset = max(int(request.GET.get("offset", "0")), 0)
        # Les suppressions antérieures à l'historique n'ont pas conservé les valeurs : elles sont ignorées.
        queryset = AuditLog.objects.filter(
            Q(action__in=("record_create", "record_update", "rh_reading_create", "rh_reading_update"))
            | Q(action="record_delete", details__has_key="old")
        )
        resource = request.GET.get("resource", "").strip()
        if resource:
            if resource not in RESOURCE_MODELS:
                raise ValidationError("Le type de fiche demandé est inconnu.")
            queryset = queryset.filter(target_type=resource)
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
        return JsonResponse({"status": 400, "code": "change_history_filter_rejected", "detail": detail}, status=400)
