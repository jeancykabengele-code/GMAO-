import json

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse

from .models import (DatacenterProblem, Equipment, FuelMonthlySummary, FuelRecord, GeneratorRecord, Intervention, PueRecord, Site, SparePartOperation, Ticket, UserProfile)
from .audit import record_audit
from .permissions import assert_global_page_access, assert_manage_users
from .views import require_authenticated_user


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _serialize(site):
    return {"name": site.name, "code": site.code, "active": site.active}


def _error(message, status=400):
    return JsonResponse({"status": status, "code": "site_rejected", "detail": message}, status=status)


@require_authenticated_user
def site_collection(request):
    if request.method == "GET":
        try:
            assert_global_page_access(request.gmao_profile)
        except Exception:
            try:
                assert_manage_users(request.gmao_profile)
            except Exception as error:
                return _error(str(error), 403)
        sites = Site.objects.order_by("name")
        return JsonResponse([_serialize(site) for site in sites], safe=False)

    try:
        assert_manage_users(request.gmao_profile)
    except Exception as error:
        return _error(str(error), 403)

    if request.method != "POST":
        return _error("Méthode non autorisée.", 405)

    try:
        data = _payload(request)
        name = str(data.get("name", "")).strip()
        code = str(data.get("code", "")).strip().upper()
        active = data.get("active", True)
        if not name:
            raise ValidationError("Le nom du site est obligatoire.")
        if not code:
            raise ValidationError("Le code du site est obligatoire.")
        if not isinstance(active, bool):
            raise ValidationError("Le statut actif est invalide.")
        site = Site(name=name, code=code, active=active)
        site.save(force_insert=True)
        return JsonResponse(_serialize(site), status=201)
    except ValidationError as error:
        return _error(error.messages[0])
    except IntegrityError:
        return _error("Un site avec ce nom existe déjà.", 409)


@require_authenticated_user
def site_detail(request, site_name):
    try:
        assert_manage_users(request.gmao_profile)
    except Exception as error:
        return _error(str(error), 403)

    try:
        site = Site.objects.get(name=site_name)
    except Site.DoesNotExist:
        return _error("Site introuvable.", 404)

    if request.method == "DELETE":
        related_models = (
            Equipment, Ticket, GeneratorRecord, FuelRecord, FuelMonthlySummary,
            PueRecord, DatacenterProblem, Intervention, SparePartOperation,
        )
        if any(model.objects.filter(site=site.name).exists() for model in related_models):
            return _error("Ce site possède encore des données métier. Désactivez-le plutôt que de le supprimer.", 409)
        if UserProfile.objects.filter(site=site.name).exists():
            return _error("Ce site est encore associé à un utilisateur. Réaffectez-le avant de le supprimer.", 409)
        snapshot = _serialize(site)
        with transaction.atomic():
            site.delete()
            record_audit(request, "site_delete", "site", site_name, details={"old": snapshot})
        return HttpResponse(status=204)
    if request.method not in {"PATCH", "PUT"}:
        return _error("Méthode non autorisée.", 405)

    try:
        data = _payload(request)
        if "code" in data:
            code = str(data["code"]).strip().upper()
            if not code:
                raise ValidationError("Le code du site est obligatoire.")
            site.code = code
        if "active" in data:
            if not isinstance(data["active"], bool):
                raise ValidationError("Le statut actif est invalide.")
            site.active = data["active"]
        if "name" in data:
            name = str(data["name"]).strip()
            if not name:
                raise ValidationError("Le nom du site est obligatoire.")
            site.name = name
        Site.objects.filter(name=site.name).update(code=site.code, active=site.active)
        site.refresh_from_db()
        return JsonResponse(_serialize(site))
    except ValidationError as error:
        return _error(error.messages[0])
    except IntegrityError:
        return _error("Un site avec ce nom existe déjà.", 409)
