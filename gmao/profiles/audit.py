import json
from datetime import date
from uuid import UUID

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils.dateparse import parse_date

from login_guard.limiter import client_address
from login_guard.models import AuditLog

from .models import UserProfile
from .permissions import assert_view_audit_log
from .views import require_authenticated_user


FORBIDDEN_DETAIL_KEYS = ("password", "token", "secret", "authorization", "credential")
ALLOWED_RESULTS = {"success", "failure", "blocked"}
# Ces événements alimentent la feuille « Historique RH » et non le journal d’audit.
RH_HISTORY_ACTIONS = ("rh_reading_create", "rh_reading_update")


def _safe_details(details):
    value = details or {}
    if not isinstance(value, dict):
        raise ValueError("Les détails d’audit doivent être un objet.")

    def inspect(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if any(forbidden in str(key).lower() for forbidden in FORBIDDEN_DETAIL_KEYS):
                    raise ValueError("Un secret ne peut pas être écrit dans le journal d’audit.")
                inspect(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                inspect(child)

    inspect(value)
    normalized = json.loads(json.dumps(value, default=str, ensure_ascii=False))
    if len(json.dumps(normalized, ensure_ascii=False)) > 16_384:
        raise ValueError("Les détails d’audit dépassent la taille autorisée.")
    return normalized


def record_audit(request, action, target_type, target_id="", result="success", details=None, *, actor=None, actor_email=""):
    if result not in ALLOWED_RESULTS:
        raise ValueError("Résultat d’audit invalide.")
    resolved_actor = actor if actor is not None else getattr(request, "gmao_profile", None)
    return AuditLog.objects.create(
        actor_id=getattr(resolved_actor, "id", None),
        actor_email=str(getattr(resolved_actor, "email", actor_email) or actor_email or "")[:254],
        action=str(action)[:64],
        target_type=str(target_type)[:64],
        target_id=str(target_id or "")[:255],
        result=result,
        ip_address=client_address(request),
        details=_safe_details(details),
    )


def _profile_emails(entries):
    """Adresses e-mail des comptes ciblés, pour afficher autre chose qu'un identifiant."""
    ids = set()
    for entry in entries:
        if entry.target_type == "profile":
            try:
                ids.add(UUID(entry.target_id))
            except ValueError:
                pass
    return {str(profile_id): email for profile_id, email in UserProfile.objects.filter(id__in=ids).values_list("id", "email")}


def _target_email(entry, emails):
    details = entry.details if isinstance(entry.details, dict) else {}
    old = details.get("old") if isinstance(details.get("old"), dict) else {}
    return emails.get(entry.target_id) or details.get("targetEmail") or details.get("email") or old.get("email") or ""


def _serialize(entry, emails=None):
    return {
        "id": entry.id,
        "actorId": str(entry.actor_id) if entry.actor_id else None,
        "actorEmail": entry.actor_email,
        "action": entry.action,
        "targetType": entry.target_type,
        "targetId": entry.target_id,
        "targetEmail": _target_email(entry, emails or {}) if entry.target_type == "profile" else "",
        "result": entry.result,
        "ipAddress": entry.ip_address,
        "details": entry.details,
        "createdAt": entry.created_at.isoformat(),
    }


def _date_parameter(request, name):
    raw = request.GET.get(name, "").strip()
    if not raw:
        return None
    parsed = parse_date(raw)
    if not isinstance(parsed, date):
        raise ValidationError(f"Le filtre {name} doit être une date ISO.")
    return parsed


@require_authenticated_user
def audit_collection(request):
    try:
        assert_view_audit_log(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "audit_log_denied", "detail": str(error)}, status=403)
    if request.method != "GET":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        limit = min(max(int(request.GET.get("limit", "50")), 1), 100)
        offset = max(int(request.GET.get("offset", "0")), 0)
        queryset = AuditLog.objects.exclude(action__in=RH_HISTORY_ACTIONS)
        if action := request.GET.get("action", "").strip():
            queryset = queryset.filter(action=action)
        if result := request.GET.get("result", "").strip():
            if result not in ALLOWED_RESULTS:
                raise ValidationError("Le résultat demandé est invalide.")
            queryset = queryset.filter(result=result)
        if actor := request.GET.get("actor", "").strip():
            queryset = queryset.filter(actor_email__icontains=actor)
        if target_type := request.GET.get("targetType", "").strip():
            queryset = queryset.filter(target_type=target_type)
        if start := _date_parameter(request, "from"):
            queryset = queryset.filter(created_at__date__gte=start)
        if end := _date_parameter(request, "to"):
            queryset = queryset.filter(created_at__date__lte=end)
        total = queryset.count()
        page = list(queryset[offset:offset + limit])
        emails = _profile_emails(page)
        items = [_serialize(entry, emails) for entry in page]
        return JsonResponse({"items": items, "total": total, "limit": limit, "offset": offset})
    except (TypeError, ValueError, ValidationError) as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"status": 400, "code": "audit_filter_rejected", "detail": detail}, status=400)
