from datetime import timedelta
from decimal import Decimal

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone

from .models import GeneratorRecord, Notification, UserProfile
from .permissions import GLOBAL_ROLES, PermissionDeniedError, assert_global_page_access
from .views import require_supabase_user


RESOURCE_LABELS = {
    "equipements": "Équipements",
    "tickets": "Gestion des tickets",
    "groupes-electrogenes": "Suivi des groupes électrogènes",
    "fuel-ge": "Fuel-GE",
    "fuel-ravitaillements": "Ravitaillement Fuel",
    "fuel-summary": "Synthèse Fuel-GE",
    "pue": "Suivi du PUE",
    "problemes-datacenter": "Problèmes Data Center",
    "interventions": "Interventions réalisées",
    "pieces-rechange": "Pièces de rechange",
}

RESOURCE_PATHS = {
    "equipements": "/equipements",
    "tickets": "/gestion-tickets",
    "groupes-electrogenes": "/maintenance/suivi-groupes-electrogenes",
    "fuel-ge": "/fuel-ge",
    "fuel-ravitaillements": "/ravitaillement-fuel",
    "fuel-summary": "/fuel-ge",
    "pue": "/pue",
    "problemes-datacenter": "/problemes-datacenter",
    "interventions": "/maintenance/interventions-realisees",
    "pieces-rechange": "/pieces-rechange",
}


def _global_recipients(actor_id):
    return list(
        UserProfile.objects.filter(active=True, role__in=GLOBAL_ROLES)
        .exclude(id=actor_id)
        .only("id")
    )


def _save_notifications(notifications):
    if notifications:
        Notification.objects.bulk_create(notifications, ignore_conflicts=True)


def notify_record_created(actor, resource, record):
    if actor.role != "chef_site":
        return
    label = RESOURCE_LABELS.get(resource, resource)
    notifications = [
        Notification(
            recipient_id=recipient.id,
            actor_id=actor.id,
            site=record.site,
            event_type="record_created",
            resource=resource,
            resource_id=record.id,
            title=f"Nouvel ajout — {label}",
            message=f"{actor.full_name} a ajouté une donnée dans {label} pour le site {record.site}.",
            severity="info",
            dedupe_key=f"record-created:{resource}:{record.id}",
        )
        for recipient in _global_recipients(actor.id)
    ]
    _save_notifications(notifications)


def generator_alert_stage(record):
    hours = Decimal(str(record.rh_depuis_derniere_pm))
    if record.etat == "PmDepassee" or hours >= Decimal("250"):
        return "overdue", "PM dépassée", "critical"
    if record.etat == "PmUrgente" or hours >= Decimal("225"):
        return "urgent", "PM urgente", "critical"
    if record.etat == "ASurveiller" or hours >= Decimal("175") or record.retard_signale:
        return "watch", "À surveiller", "warning"
    if hours >= Decimal("150"):
        return "approaching", "Approche de l’état À surveiller", "warning"
    return None


def notify_generator_alert(actor, record):
    stage = generator_alert_stage(record)
    if not stage:
        return
    stage_code, stage_label, severity = stage
    pm_cycle = str(record.rh_derniere_pm).replace(".", "_")
    notifications = [
        Notification(
            recipient_id=recipient.id,
            actor_id=actor.id,
            site=record.site,
            event_type="generator_alert",
            resource="groupes-electrogenes",
            resource_id=record.id,
            title=f"Alerte GE — {stage_label}",
            message=(
                f"Le groupe {record.code} du site {record.site} totalise "
                f"{record.rh_depuis_derniere_pm} h depuis la dernière PM."
            ),
            severity=severity,
            dedupe_key=f"ge:{record.id}:{pm_cycle}:{stage_code}",
        )
        for recipient in _global_recipients(actor.id)
    ]
    _save_notifications(notifications)


def notify_stale_generator_readings():
    """Create persistent reminders when a GE reading has not been updated."""
    now = timezone.now()
    try:
        records = list(GeneratorRecord.objects.filter(updated_at__lt=now - timedelta(days=7)))
    except (DatabaseError, AttributeError):
        return
    recipients = _global_recipients(None)
    notifications = []
    for record in records:
        age_days = (now - record.updated_at).days
        if age_days >= 14:
            stage_code, title, severity = "critical", "Relevé GE ancien", "critical"
            message = (f"Le dernier relevé du groupe {record.code} du site {record.site} "
                       f"date de {age_days} jours. Une mise à jour est nécessaire.")
        else:
            stage_code, title, severity = "warning", "Relevé GE à mettre à jour", "warning"
            message = (f"Le dernier relevé du groupe {record.code} du site {record.site} "
                       f"date de {age_days} jours. Merci de mettre le compteur à jour.")
        reading_key = record.updated_at.isoformat().replace("+", "_").replace(":", "_")
        for recipient in recipients:
            notifications.append(Notification(
                recipient_id=recipient.id,
                site=record.site,
                event_type="generator_reading_stale",
                resource="groupes-electrogenes",
                resource_id=record.id,
                title=title,
                message=message,
                severity=severity,
                dedupe_key=f"ge-reading:{record.id}:{reading_key}:{stage_code}",
            ))
    _save_notifications(notifications)

def _serialize(notification):
    return {
        "id": str(notification.id),
        "site": notification.site,
        "eventType": notification.event_type,
        "resource": notification.resource,
        "resourceId": str(notification.resource_id) if notification.resource_id else None,
        "title": notification.title,
        "message": notification.message,
        "severity": notification.severity,
        "actionPath": RESOURCE_PATHS.get(notification.resource),
        "readAt": notification.read_at.isoformat() if notification.read_at else None,
        "createdAt": notification.created_at.isoformat(),
    }


def _forbidden(error):
    return JsonResponse({"status": 403, "code": "notifications_forbidden", "detail": str(error)}, status=403)


@require_supabase_user
def notification_collection(request):
    try:
        assert_global_page_access(request.gmao_profile)
    except PermissionDeniedError as error:
        return _forbidden(error)
    if request.method != "GET":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)

    try:
        limit = min(max(int(request.GET.get("limit", "40")), 1), 100)
    except ValueError:
        limit = 40
    notify_stale_generator_readings()
    notifications = Notification.objects.filter(recipient_id=request.gmao_profile.id).order_by("-created_at")[:limit]
    unread_count = Notification.objects.filter(
        recipient_id=request.gmao_profile.id,
        read_at__isnull=True,
    ).count()
    return JsonResponse({
        "items": [_serialize(notification) for notification in notifications],
        "unreadCount": unread_count,
    })


@require_supabase_user
def mark_notification_read(request, notification_id):
    try:
        assert_global_page_access(request.gmao_profile)
    except PermissionDeniedError as error:
        return _forbidden(error)
    if request.method != "PATCH":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        notification = Notification.objects.get(
            id=notification_id,
            recipient_id=request.gmao_profile.id,
        )
    except Notification.DoesNotExist:
        return JsonResponse({"detail": "Notification introuvable."}, status=404)
    if not notification.read_at:
        notification.read_at = timezone.now()
        notification.save(update_fields=["read_at"])
    return JsonResponse(_serialize(notification))


@require_supabase_user
def mark_all_notifications_read(request):
    try:
        assert_global_page_access(request.gmao_profile)
    except PermissionDeniedError as error:
        return _forbidden(error)
    if request.method != "PATCH":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    updated = Notification.objects.filter(
        recipient_id=request.gmao_profile.id,
        read_at__isnull=True,
    ).update(read_at=timezone.now())
    return JsonResponse({"status": "read", "updated": updated})
