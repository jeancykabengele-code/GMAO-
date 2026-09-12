import calendar
import json
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, models, transaction
from django.http import JsonResponse

from .models import (
    DatacenterProblem,
    Equipment,
    FuelDelivery,
    FuelMonthlySummary,
    FuelRecord,
    GeneratorRecord,
    Intervention,
    PueRecord,
    SparePartOperation,
    Site,
    Ticket,
)
from .notifications import notify_generator_alert, notify_record_created
from .permissions import (
    GLOBAL_ROLES,
    PermissionDeniedError,
    assert_can_create,
    assert_can_delete,
    assert_can_delete_equipment,
    assert_can_modify,
    assert_site_access,
)
from .views import require_supabase_user


RESOURCE_MODELS = {
    "equipements": Equipment,
    "tickets": Ticket,
    "groupes-electrogenes": GeneratorRecord,
    "fuel-ge": FuelRecord,
    "fuel-ravitaillements": FuelDelivery,
    "fuel-summary": FuelMonthlySummary,
    "pue": PueRecord,
    "problemes-datacenter": DatacenterProblem,
    "interventions": Intervention,
    "pieces-rechange": SparePartOperation,
}

CAMEL_TO_SNAKE = {
    "dateMiseEnService": "date_mise_en_service",
    "marqueModele": "marque_modele",
    "typeGe": "type_ge",
    "moisReleve": "mois_releve",
    "dateDernierePm": "date_derniere_pm",
    "createdAt": "created_at",
    "updatedAt": "updated_at",
    "rhActuel": "rh_actuel",
    "rhDernierePm": "rh_derniere_pm",
    "rhDepuisDernierePm": "rh_depuis_derniere_pm",
    "rhProchainePm": "rh_prochaine_pm",
    "retardSignale": "retard_signale",
    "dateRavitaillement": "date_ravitaillement",
    "bonLivraison": "bon_livraison",
    "typeCarburant": "type_carburant",
    "quantiteRecue": "quantite_recue",
    "stockAvant": "stock_avant",
    "stockApres": "stock_apres",
    "numeroCiterne": "numero_citerne",
    "receptionnePar": "receptionne_par",
    "differenceStock": "difference_stock",
    "stockInitial": "stock_initial",
    "stockFinal": "stock_final",
    "heuresGe": "heures_ge",
    "litresHeure": "litres_heure",
    "snelKwh": "snel_kwh",
    "disponibiliteGrid": "disponibilite_grid",
    "energieIt": "energie_it",
    "energieTotale": "energie_totale",
    "besoinSpare": "besoin_spare",
    "prochaineEtape": "prochaine_etape",
    "ticketNumber": "ticket_number",
    "travailRealise": "travail_realise",
    "dureeHeures": "duree_heures",
}
SNAKE_TO_CAMEL = {value: key for key, value in CAMEL_TO_SNAKE.items()}
PROTECTED_FIELDS = {"id", "created_by", "created_at", "updated_by", "updated_at"}


def _equipment_site_code(site):
    configured_code = Site.objects.filter(name=site, active=True).values_list("code", flat=True).first()
    source = configured_code or site
    normalized = unicodedata.normalize("NFKD", source).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z0-9]", "", normalized.upper()) or "SITE"


def _next_equipment_code(site_code, existing_codes):
    prefix = f"EQ-{site_code}-"
    numbers = []
    for code in existing_codes:
        suffix = code.removeprefix(prefix)
        if code.startswith(prefix) and suffix.isdigit():
            numbers.append(int(suffix))
    return f"{prefix}{max(numbers, default=0) + 1:04d}"


def _generate_equipment_code(site):
    site_code = _equipment_site_code(site)
    prefix = f"EQ-{site_code}-"
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext(%s))", [f"gmao-equipment:{site}"])
    existing_codes = Equipment.objects.filter(site=site, code__startswith=prefix).values_list("code", flat=True)
    return _next_equipment_code(site_code, existing_codes)


def _calculate_generator_values(values, record=None):
    rh_actuel = values.get("rh_actuel", getattr(record, "rh_actuel", None))
    rh_derniere_pm = values.get("rh_derniere_pm", getattr(record, "rh_derniere_pm", None))
    retard_signale = values.get("retard_signale", getattr(record, "retard_signale", False))
    if rh_actuel is None or rh_derniere_pm is None:
        raise ValidationError("Les compteurs RH actuel et RH dernière PM sont obligatoires.")
    if rh_actuel < rh_derniere_pm:
        raise ValidationError("Le compteur RH actuel ne peut pas être inférieur au compteur de la dernière PM.")
    rh_depuis_pm = rh_actuel - rh_derniere_pm
    values["rh_depuis_derniere_pm"] = rh_depuis_pm
    values["rh_prochaine_pm"] = rh_derniere_pm + Decimal("250")
    if rh_depuis_pm >= Decimal("250"):
        values["etat"] = "PmDepassee"
    elif rh_depuis_pm >= Decimal("225"):
        values["etat"] = "PmUrgente"
    elif rh_depuis_pm >= Decimal("175") or retard_signale:
        values["etat"] = "ASurveiller"
    else:
        values["etat"] = "Normal"
    return values


NO_GRID_SITES = {"Kikwit", "Mbandaka"}


def _calculate_fuel_values(values, record=None):
    site = values.get("site", getattr(record, "site", None))
    periode = values.get("periode", getattr(record, "periode", None))
    sortie = values.get("sortie", getattr(record, "sortie", None))
    heures_ge = values.get("heures_ge", getattr(record, "heures_ge", None))
    if not periode or not re.fullmatch(r"\d{4}-\d{2}", periode):
        raise ValidationError("La période doit être au format AAAA-MM.")
    try:
        year, month = (int(value) for value in periode.split("-"))
        month_hours = Decimal(calendar.monthrange(year, month)[1] * 24)
    except (ValueError, calendar.IllegalMonthError) as error:
        raise ValidationError("La période est invalide.") from error
    if sortie is None or heures_ge is None:
        raise ValidationError("La consommation et les heures GE sont obligatoires.")
    if sortie < 0 or heures_ge < 0:
        raise ValidationError("La consommation et les heures GE ne peuvent pas être négatives.")
    for field_name, label in (
        ("stock_initial", "Le stock initial"),
        ("entree", "Le volume reçu"),
        ("stock_final", "Le stock final"),
    ):
        field_value = values.get(field_name, getattr(record, field_name, None))
        if field_value is not None and field_value < 0:
            raise ValidationError(f"{label} ne peut pas être négatif.")
    if heures_ge > 0:
        values["litres_heure"] = (sortie / heures_ge).quantize(Decimal("0.001"))
    else:
        values["litres_heure"] = Decimal("0") if sortie == 0 else None
    if site in NO_GRID_SITES:
        values["snel_kwh"] = None
        values["disponibilite_grid"] = Decimal("0")
    else:
        availability = (Decimal("1") - (heures_ge / month_hours)) * Decimal("100")
        values["disponibilite_grid"] = max(Decimal("0"), min(Decimal("100"), availability)).quantize(Decimal("0.01"))
    return values

def _calculate_fuel_delivery_values(values, record=None):
    quantity = values.get("quantite_recue", getattr(record, "quantite_recue", None))
    stock_before = values.get("stock_avant", getattr(record, "stock_avant", None))
    stock_after = values.get("stock_apres", getattr(record, "stock_apres", None))
    if quantity is None or stock_before is None:
        raise ValidationError("La quantité reçue et le stock avant livraison sont obligatoires.")
    if quantity < 0 or stock_before < 0 or (stock_after is not None and stock_after < 0):
        raise ValidationError("Les quantités et les stocks ne peuvent pas être négatifs.")
    calculated_after = stock_before + quantity
    if stock_after is None:
        stock_after = calculated_after
        values["stock_apres"] = stock_after
    values["difference_stock"] = abs(stock_after - calculated_after) > Decimal("0.001")
    return values


def _calculate_pue_values(values, record=None):
    energie_it = values.get("energie_it", getattr(record, "energie_it", None))
    energie_totale = values.get("energie_totale", getattr(record, "energie_totale", None))
    if energie_it is None or energie_totale is None:
        raise ValidationError("Les énergies IT et totale sont obligatoires.")
    if energie_it <= 0 or energie_totale <= 0:
        raise ValidationError("Les énergies IT et totale doivent être supérieures à zéro.")
    if energie_totale < energie_it:
        raise ValidationError("L’énergie totale ne peut pas être inférieure à l’énergie IT.")
    values["pue"] = (energie_totale / energie_it).quantize(Decimal("0.001"))
    return values
def _resource_model(resource):
    return RESOURCE_MODELS.get(resource)


def _serialize(record):
    result = {}
    for field in record._meta.concrete_fields:
        if field.name in {"created_by", "updated_by"}:
            continue
        value = getattr(record, field.name)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        elif isinstance(value, Decimal):
            value = float(value)
        elif value is not None and field.name == "id":
            value = str(value)
        result[SNAKE_TO_CAMEL.get(field.name, field.name)] = value
    return result


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _clean_values(model_class, payload):
    fields = {field.name: field for field in model_class._meta.concrete_fields}
    values = {}
    for key, value in payload.items():
        field_name = CAMEL_TO_SNAKE.get(key, key)
        if field_name in PROTECTED_FIELDS:
            continue
        field = fields.get(field_name)
        if not field:
            raise ValidationError(f"Champ inconnu : {key}.")
        if value == "" and field.null:
            value = None
        values[field_name] = field.to_python(value)
    if not values.get("site"):
        raise ValidationError("Le site est obligatoire.")
    return values


def _error(error, status=400):
    detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
    return JsonResponse({"status": status, "code": "record_rejected", "detail": detail}, status=status)


@require_supabase_user
def record_collection(request, resource):
    model_class = _resource_model(resource)
    if not model_class:
        return JsonResponse({"detail": "Ressource inconnue."}, status=404)
    profile = request.gmao_profile

    if request.method == "GET":
        rows = model_class.objects.all()
        if profile.role not in GLOBAL_ROLES:
            rows = rows.filter(site=profile.site)
        return JsonResponse([_serialize(row) for row in rows.order_by("-created_at")], safe=False)

    if request.method == "POST":
        try:
            values = _clean_values(model_class, _payload(request))
            assert_can_create(profile, values["site"])
            with transaction.atomic():
                if model_class is Equipment:
                    values["code"] = _generate_equipment_code(values["site"])
                if model_class is GeneratorRecord:
                    _calculate_generator_values(values)
                if model_class is FuelRecord:
                    _calculate_fuel_values(values)
                if model_class is FuelDelivery:
                    _calculate_fuel_delivery_values(values)
                if model_class is PueRecord:
                    _calculate_pue_values(values)
                record = model_class(**values, created_by=profile.id)
                record.full_clean(exclude=["updated_by"])
                record.save(force_insert=True)
                if model_class in {GeneratorRecord, FuelRecord, FuelDelivery, PueRecord}:
                    record.refresh_from_db()
                notify_record_created(profile, resource, record)
                if model_class is GeneratorRecord:
                    notify_generator_alert(profile, record)
            return JsonResponse(_serialize(record), status=201)
        except (ValidationError, PermissionDeniedError) as error:
            return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)
        except IntegrityError:
            return JsonResponse(
                {
                    "status": 409,
                    "code": "duplicate_record",
                    "detail": "Un enregistrement avec ces informations existe déjà.",
                },
                status=409,
            )

    return JsonResponse({"detail": "Méthode non autorisée."}, status=405)


@require_supabase_user
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
            if model_class is GeneratorRecord:
                assert_site_access(profile, values["site"])
                _calculate_generator_values(values, record)
            elif model_class is FuelRecord:
                assert_can_modify(profile, values["site"])
                _calculate_fuel_values(values, record)
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
            record.full_clean()
            record.save()
            if model_class in {GeneratorRecord, FuelRecord, FuelDelivery, PueRecord}:
                record.refresh_from_db()
            if model_class is GeneratorRecord:
                notify_generator_alert(profile, record)
            return JsonResponse(_serialize(record))
        if request.method == "DELETE":
            if model_class is not Equipment:
                assert_can_delete(profile)
            assert_can_delete_equipment(profile)
            deleted_id = str(record.id)
            record.delete()
            return JsonResponse({"status": "deleted", "id": deleted_id})
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    except (ValidationError, PermissionDeniedError) as error:
        return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)