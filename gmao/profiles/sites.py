import json
import logging
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse

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
from .audit import record_audit
from .permissions import assert_global_page_access, assert_manage_users
from .records import _recalculate_fuel_records
from .views import require_authenticated_user


logger = logging.getLogger(__name__)

SITE_DATA_MODELS = (
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
)


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _serialize(site):
    return {"name": site.name, "code": site.code, "active": site.active, "gridConnected": site.grid_connected}


def _error(message, status=400):
    return JsonResponse({"status": status, "code": "site_rejected", "detail": message}, status=status)


def _move_site_references(old_name, new_name):
    for model in SITE_DATA_MODELS:
        model.objects.filter(site=old_name).update(site=new_name)
    Notification.objects.filter(site=old_name).update(site=new_name)
    UserProfile.objects.filter(site=old_name).update(site=new_name)


def _sync_fuel_with_grid(site_name, grid_connected, actor_id):
    if not grid_connected:
        FuelRecord.objects.filter(site=site_name).update(snel_kwh=None, disponibilite_grid=Decimal("0"))
        return
    first_period = FuelRecord.objects.filter(site=site_name).order_by("periode").values_list("periode", flat=True).first()
    if not first_period:
        return
    try:
        _recalculate_fuel_records(site_name, first_period, actor_id)
    except ValidationError:
        logger.warning("Recalcul Fuel-GE impossible après raccordement du site %s", site_name)


def _grid_connected(data, default):
    if "gridConnected" in data:
        raw = data["gridConnected"]
    elif "grid_connected" in data:
        raw = data["grid_connected"]
    else:
        return default
    if not isinstance(raw, bool):
        raise ValidationError("Le raccordement au réseau est invalide.")
    return raw


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
        grid_connected = _grid_connected(data, True)
        if not name:
            raise ValidationError("Le nom du site est obligatoire.")
        if not code:
            raise ValidationError("Le code du site est obligatoire.")
        if not isinstance(active, bool):
            raise ValidationError("Le statut actif est invalide.")
        with transaction.atomic():
            site = Site(name=name, code=code, active=active, grid_connected=grid_connected)
            site.save(force_insert=True)
            record_audit(
                request, "site_create", "site", site.name,
                details={"name": site.name, "code": site.code, "active": site.active, "gridConnected": site.grid_connected},
            )
        return JsonResponse(_serialize(site), status=201)
    except ValidationError as error:
        return _error(error.messages[0])
    except IntegrityError:
        return _error("Un site avec ce nom ou ce code existe déjà.", 409)


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
        if any(model.objects.filter(site=site.name).exists() for model in SITE_DATA_MODELS):
            return _error("Ce site possède encore des données métier. Désactivez-le plutôt que de le supprimer.", 409)
        if Notification.objects.filter(site=site.name).exists():
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
        old_name = site.name
        old_snapshot = _serialize(site)
        new_name = old_name
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
            new_name = str(data["name"]).strip()
            if not new_name:
                raise ValidationError("Le nom du site est obligatoire.")
        grid_connected = _grid_connected(data, site.grid_connected)
        with transaction.atomic():
            if new_name != old_name:
                if Site.objects.filter(name=new_name).exists():
                    return _error("Un site avec ce nom existe déjà.", 409)
                _move_site_references(old_name, new_name)
            Site.objects.filter(name=old_name).update(
                name=new_name, code=site.code, active=site.active, grid_connected=grid_connected,
            )
            site = Site.objects.get(name=new_name)
            if grid_connected != old_snapshot["gridConnected"]:
                _sync_fuel_with_grid(site.name, grid_connected, request.gmao_profile.id)
            record_audit(
                request, "site_update", "site", site.name,
                details={"old": old_snapshot, "new": _serialize(site)},
            )
        return JsonResponse(_serialize(site))
    except ValidationError as error:
        return _error(error.messages[0])
    except IntegrityError:
        return _error("Un site avec ce nom ou ce code existe déjà.", 409)
    except Site.DoesNotExist:
        return _error("Site introuvable.", 404)
