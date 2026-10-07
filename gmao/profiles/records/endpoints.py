"""Routes de l'API des fiches métier : liste, création, modification et suppression."""

import logging

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse

from ..audit import record_audit
from ..models import DatacenterProblem, Equipment, FuelDelivery, FuelRecord, GeneratorFuelConsumption, GeneratorMonthlyReading, GeneratorRecord, PueRecord, Ticket
from ..notifications import notify_generator_alert, notify_record_created
from ..permissions import GLOBAL_ROLES, PermissionDeniedError, assert_can_correct_reading, assert_can_create, assert_can_delete, assert_can_delete_equipment, assert_can_delete_fuel_record, assert_can_delete_ticket, assert_can_modify, assert_site_access
from ..views import require_authenticated_user
from .fuel import _assert_fuel_manual_fields_are_not_sent, _calculate_fuel_values, _calculate_generator_fuel_consumption, _recalculate_fuel_records, _recalculate_fuel_records_after_reading_change
from .generators import _assert_generator_code_unique, _calculate_generator_values, _discard_orphan_generator_records, _set_generator_from_equipment, _sync_generator_current_from_readings, _validate_monthly_reading
from .deliveries import _calculate_fuel_delivery_values, _recalculate_fuel_records_after_delivery_change
from .pue import _calculate_pue_values
from .serialization import _clean_values, _error, _history_snapshot, _payload, _resource_model, _round_decimal_fields, _serialize
from .equipment import _generate_equipment_code


logger = logging.getLogger(__name__)


@require_authenticated_user
def record_collection(request, resource):
    model_class = _resource_model(resource)
    if not model_class:
        return JsonResponse({"detail": "Ressource inconnue."}, status=404)
    profile = request.gmao_profile

    if request.method == "GET":
        try:
            rows = model_class.objects.all()
            if profile.role not in GLOBAL_ROLES:
                rows = rows.filter(site=profile.site)
            return JsonResponse([_serialize(row) for row in rows.order_by("-created_at")], safe=False)
        except Exception:
            logger.exception("Lecture MySQL impossible pour la ressource %s", resource)
            return JsonResponse(
                {"status": 500, "code": "record_read_failed", "detail": "Les données ne sont pas disponibles pour le moment."},
                status=500,
            )

    if request.method == "POST":
        try:
            values = _clean_values(model_class, _payload(request))
            assert_can_create(profile, values["site"])
            with transaction.atomic():
                if model_class is Equipment:
                    values["code"] = _generate_equipment_code(values["site"])
                elif model_class is DatacenterProblem and profile.role not in GLOBAL_ROLES:
                    values["statut"] = "Open"
                elif model_class is GeneratorRecord:
                    _set_generator_from_equipment(values)
                    _discard_orphan_generator_records(values)
                    _assert_generator_code_unique(values)
                    _calculate_generator_values(values)
                elif model_class is GeneratorMonthlyReading:
                    _validate_monthly_reading(values)
                elif model_class is FuelRecord:
                    _assert_fuel_manual_fields_are_not_sent(values)
                    _calculate_fuel_values(values, allow_initial_stock=profile.role in (GLOBAL_ROLES | {"chef_site"}))
                elif model_class is GeneratorFuelConsumption:
                    _calculate_generator_fuel_consumption(values)
                elif model_class is FuelDelivery:
                    _calculate_fuel_delivery_values(values)
                elif model_class is PueRecord:
                    _calculate_pue_values(values)
                record = model_class(**values, created_by=profile.id)
                _round_decimal_fields(record)
                record.full_clean(exclude=["updated_by"])
                record.save(force_insert=True)
                if model_class is GeneratorRecord:
                    pass
                elif model_class is GeneratorMonthlyReading:
                    _sync_generator_current_from_readings(record.site, record.groupe_code, profile.id)
                    _recalculate_fuel_records_after_reading_change(record.site, record.periode, profile.id)
                elif model_class is FuelRecord:
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is GeneratorFuelConsumption:
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is FuelDelivery:
                    _recalculate_fuel_records_after_delivery_change(record.site, record.periode, profile.id)
                if model_class in {GeneratorRecord, GeneratorMonthlyReading, FuelRecord, FuelDelivery, PueRecord}:
                    record.refresh_from_db()
                new_snapshot = _history_snapshot(record)
                record_audit(request, "record_create", resource, record.id, details={"site": record.site, "new": new_snapshot})
                notify_record_created(profile, resource, record)
                if model_class is GeneratorRecord:
                    notify_generator_alert(profile, record)
            return JsonResponse(_serialize(record), status=201)
        except (ValidationError, PermissionDeniedError) as error:
            return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)
        except IntegrityError:
            return JsonResponse({"status": 409, "code": "duplicate_record", "detail": "Un enregistrement avec ces informations existe déjà."}, status=409)
    return JsonResponse({"detail": "Méthode non autorisée."}, status=405)


@require_authenticated_user
def record_detail(request, resource, record_id):
    model_class = _resource_model(resource)
    if not model_class:
        return JsonResponse({"detail": "Ressource inconnue."}, status=404)
    try:
        record = model_class.objects.get(id=record_id)
    except model_class.DoesNotExist:
        return JsonResponse({"detail": "Fiche introuvable."}, status=404)
    profile = request.gmao_profile
    try:
        assert_site_access(profile, record.site)
        if request.method in {"PUT", "PATCH"}:
            values = _clean_values(model_class, _payload(request))
            with transaction.atomic():
                previous_site = record.site
                old_snapshot = _history_snapshot(record)
                previous_period = (record.mois_releve if model_class is GeneratorRecord else record.periode if model_class in {GeneratorMonthlyReading, GeneratorFuelConsumption, FuelRecord, FuelDelivery} else None)
                if model_class is GeneratorRecord:
                    assert_site_access(profile, values["site"])
                    _set_generator_from_equipment(values, record)
                    _assert_generator_code_unique(values, record)
                    _calculate_generator_values(values, record)
                elif model_class is GeneratorMonthlyReading:
                    assert_can_correct_reading(profile, values["site"])
                    _validate_monthly_reading(values, record)
                elif model_class is FuelRecord:
                    assert_can_modify(profile, values["site"])
                    _assert_fuel_manual_fields_are_not_sent(values, record)
                    _calculate_fuel_values(values, record, allow_initial_stock=profile.role in (GLOBAL_ROLES | {"chef_site"}))
                elif model_class is GeneratorFuelConsumption:
                    assert_can_modify(profile, values["site"])
                    _calculate_generator_fuel_consumption(values, record)
                elif model_class is FuelDelivery:
                    assert_can_modify(profile, values["site"])
                    _calculate_fuel_delivery_values(values, record)
                elif model_class is PueRecord:
                    assert_can_modify(profile, values["site"])
                    _calculate_pue_values(values, record)
                else:
                    assert_can_modify(profile, values["site"])
                for field, value in values.items():
                    setattr(record, field, value)
                record.updated_by = profile.id
                _round_decimal_fields(record)
                record.full_clean()
                record.save()
                if model_class is GeneratorRecord:
                    pass
                elif model_class is GeneratorMonthlyReading:
                    _sync_generator_current_from_readings(previous_site, record.groupe_code, profile.id)
                    _sync_generator_current_from_readings(record.site, record.groupe_code, profile.id)
                    _recalculate_fuel_records_after_reading_change(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records_after_reading_change(record.site, record.periode, profile.id)
                elif model_class is FuelRecord:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is GeneratorFuelConsumption:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is FuelDelivery:
                    _recalculate_fuel_records_after_delivery_change(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records_after_delivery_change(record.site, record.periode, profile.id)
                if model_class in {GeneratorRecord, GeneratorMonthlyReading, FuelRecord, FuelDelivery, PueRecord}:
                    record.refresh_from_db()
                new_snapshot = _history_snapshot(record)
                if new_snapshot != old_snapshot:
                    record_audit(request, "record_update", resource, record.id, details={"site": record.site, "old": old_snapshot, "new": new_snapshot})
                if model_class is GeneratorRecord:
                    notify_generator_alert(profile, record)
            return JsonResponse(_serialize(record))
        if request.method == "DELETE":
            if model_class is Equipment:
                assert_can_delete_equipment(profile)
            elif model_class is FuelRecord:
                assert_can_delete_fuel_record(profile)
            elif model_class is Ticket:
                assert_can_delete_ticket(profile)
            else:
                assert_can_delete(profile)
            deleted_id = str(record.id)
            deleted_site = record.site
            deleted_snapshot = _history_snapshot(record)
            deleted_period = record.periode if model_class in {GeneratorMonthlyReading, GeneratorFuelConsumption, FuelRecord} else None
            deleted_delivery_period = record.periode if model_class is FuelDelivery else None
            deleted_group_code = record.groupe_code if model_class is GeneratorMonthlyReading else None
            with transaction.atomic():
                record.delete()
                if deleted_group_code:
                    _sync_generator_current_from_readings(deleted_site, deleted_group_code, profile.id)
                if deleted_period:
                    _recalculate_fuel_records_after_reading_change(deleted_site, deleted_period, profile.id)
                if deleted_delivery_period:
                    _recalculate_fuel_records_after_delivery_change(deleted_site, deleted_delivery_period, profile.id)
                record_audit(request, "record_delete", resource, deleted_id, details={"site": deleted_site, "old": deleted_snapshot})
            return JsonResponse({"status": "deleted", "id": deleted_id})
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    except (ValidationError, PermissionDeniedError) as error:
        return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)
