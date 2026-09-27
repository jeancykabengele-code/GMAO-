import json
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse

from login_guard.models import PasswordHistory
from .audit import record_audit
from .local_auth import LocalAuthenticationError, PasswordCompromiseCheckUnavailable, set_local_password, verify_current_password
from .models import (DatacenterProblem, Equipment, FuelDelivery, FuelMonthlySummary, FuelRecord, GeneratorRecord, Intervention, LocalCredential, PueRecord, Site, SparePartOperation, Ticket, UserProfile)
from .permissions import assert_manage_users
from .services import ALLOWED_ROLES
from .views import require_authenticated_user


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _serialize(profile):
    return {
        "id": str(profile.id),
        "email": profile.email,
        "fullName": profile.full_name,
        "role": profile.role,
        "site": profile.site,
        "active": profile.active,
        "createdAt": profile.created_at.isoformat() if profile.created_at else None,
    }


def _profile_has_business_history(profile_id):
    models = (Equipment, Ticket, GeneratorRecord, FuelRecord, FuelDelivery, FuelMonthlySummary, PueRecord, DatacenterProblem, Intervention, SparePartOperation)
    return any(
        model.objects.filter(created_by=profile_id).exists() or model.objects.filter(updated_by=profile_id).exists()
        for model in models
    )


def _deny_or_none(request):
    try:
        assert_manage_users(request.gmao_profile)
    except Exception as error:
        return JsonResponse({"status": 403, "code": "profile_admin_denied", "detail": str(error)}, status=403)
    return None


@require_authenticated_user
def profile_collection(request):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method == "GET":
        return JsonResponse([_serialize(profile) for profile in UserProfile.objects.order_by("email")], safe=False)
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        data = _payload(request)
        email = str(data.get("email", "")).strip().lower()
        full_name = str(data.get("fullName", "")).strip()
        role = str(data.get("role", "")).strip()
        site_name = data.get("site")
        site_name = str(site_name).strip() if site_name not in (None, "") else None
        if not email or "@" not in email:
            raise ValidationError("Une adresse e-mail valide est obligatoire.")
        if not full_name:
            raise ValidationError("Le nom complet est obligatoire.")
        if role not in ALLOWED_ROLES:
            raise ValidationError("Le rôle sélectionné est invalide.")
        if role == "chef_site":
            if not site_name:
                raise ValidationError("Un chef de site doit être associé à un site actif.")
            if not Site.objects.filter(name=site_name, active=True).exists():
                raise ValidationError("Le site sélectionné est introuvable ou désactivé.")
        elif site_name:
            raise ValidationError("Seul un chef de site peut être associé à un site.")
        if UserProfile.objects.filter(email__iexact=email).exists():
            raise ValidationError("Un profil utilise déjà cette adresse e-mail.")

        with transaction.atomic():
            profile = UserProfile.objects.create(id=uuid4(), email=email, full_name=full_name, role=role, site=site_name, active=True)
            set_local_password(profile.id, data.get("password"))
            record_audit(request, "profile_create", "profile", profile.id, details={"email": profile.email, "role": profile.role, "site": profile.site, "active": profile.active})
        return JsonResponse(_serialize(profile), status=201)
    except ValidationError as error:
        return JsonResponse({"status": 400, "code": "profile_creation_failed", "detail": error.messages[0]}, status=400)
    except PasswordCompromiseCheckUnavailable as error:
        return JsonResponse({"status": 503, "code": "password_check_unavailable", "detail": str(error)}, status=503)


@require_authenticated_user
def profile_delete(request, profile_id):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method != "DELETE":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        profile = UserProfile.objects.get(id=profile_id)
        if str(profile.id) == str(request.gmao_profile.id):
            raise ValidationError("Vous ne pouvez pas supprimer votre propre compte.")
        if profile.site:
            raise ValidationError("Ce profil est encore affecté à un site. Désaffectez-le avant suppression.")
        if _profile_has_business_history(profile.id):
            raise ValidationError("Ce profil possède un historique métier. Désactivez-le plutôt que de le supprimer.")

        deleted_id = str(profile.id)
        deleted_snapshot = {"email": profile.email, "role": profile.role, "site": profile.site, "active": profile.active}
        with transaction.atomic():
            LocalCredential.objects.filter(profile_id=profile.id).delete()
            PasswordHistory.objects.filter(profile_id=profile.id).delete()
            profile.delete()
            record_audit(request, "profile_delete", "profile", deleted_id, details={"old": deleted_snapshot})
        return JsonResponse({"status": "deleted", "id": deleted_id})
    except UserProfile.DoesNotExist:
        return JsonResponse({"detail": "Utilisateur introuvable."}, status=404)
    except ValidationError as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        status = 409
        return JsonResponse({"status": status, "code": "profile_deletion_rejected", "detail": detail}, status=status)

@require_authenticated_user
def profile_detail(request, profile_id):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method != "PATCH":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        profile = UserProfile.objects.get(id=profile_id)
        data = _payload(request)
        full_name = str(data.get("fullName", profile.full_name)).strip()
        role = str(data.get("role", profile.role)).strip()
        active = data.get("active", profile.active)
        site_name = data.get("site", profile.site)
        site_name = str(site_name).strip() if site_name not in (None, "") else None
        if not full_name:
            raise ValidationError("Le nom complet est obligatoire.")
        if role not in ALLOWED_ROLES:
            raise ValidationError("Le rôle sélectionné est invalide.")
        if not isinstance(active, bool):
            raise ValidationError("Le statut actif est invalide.")
        if str(profile.id) == str(request.gmao_profile.id) and not active:
            raise ValidationError("Vous ne pouvez pas désactiver votre propre compte.")
        if role == "chef_site":
            if not site_name or not Site.objects.filter(name=site_name, active=True).exists():
                raise ValidationError("Un chef de site doit être associé à un site actif.")
        elif site_name:
            raise ValidationError("Seul un chef de site peut être associé à un site.")
        old = {"fullName": profile.full_name, "role": profile.role, "site": profile.site, "active": profile.active}
        new = {"fullName": full_name, "role": role, "site": site_name, "active": active}
        with transaction.atomic():
            UserProfile.objects.filter(id=profile.id).update(full_name=full_name, role=role, site=site_name, active=active)
            profile.refresh_from_db()
            record_audit(request, "profile_update", "profile", profile.id, details={"old": old, "new": new})
        return JsonResponse(_serialize(profile))
    except UserProfile.DoesNotExist:
        return JsonResponse({"detail": "Utilisateur introuvable."}, status=404)
    except ValidationError as error:
        detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
        status = 400
        return JsonResponse({"status": status, "code": "profile_rejected", "detail": detail}, status=status)
@require_authenticated_user
def profile_password(request, profile_id):
    denied = _deny_or_none(request)
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    try:
        profile = UserProfile.objects.get(id=profile_id, active=True)
        data = _payload(request)
        verify_current_password(request.gmao_profile, data.get("managerPassword"))
        with transaction.atomic():
            set_local_password(profile.id, data.get("password"))
            record_audit(request, "password_reset", "profile", profile.id, details={"targetEmail": profile.email})
        return JsonResponse({"status": "password_set", "profileId": str(profile.id)})
    except UserProfile.DoesNotExist:
        return JsonResponse({"detail": "Utilisateur introuvable ou inactif."}, status=404)
    except ValidationError as error:
        record_audit(request, "password_reset", "profile", profile_id, result="failure", details={"reason": "password_rejected"})
        return JsonResponse({"status": 400, "code": "password_rejected", "detail": error.messages[0]}, status=400)
    except LocalAuthenticationError as error:
        record_audit(request, "password_reset", "profile", profile_id, result="failure", details={"reason": "manager_reauthentication_failed"})
        return JsonResponse({"status": 403, "code": "manager_reauthentication_failed", "detail": str(error)}, status=403)
    except PasswordCompromiseCheckUnavailable as error:
        record_audit(request, "password_reset", "profile", profile_id, result="failure", details={"reason": "compromise_check_unavailable"})
        return JsonResponse({"status": 503, "code": "password_check_unavailable", "detail": str(error)}, status=503)
