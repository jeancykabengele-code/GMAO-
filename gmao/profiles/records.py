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
    GeneratorFuelConsumption,
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
    assert_can_delete_fuel_record,
    assert_can_delete_ticket,
    assert_can_modify,
    assert_site_access,
)
from .views import require_supabase_user


RESOURCE_MODELS = {
    "equipements": Equipment,
    "tickets": Ticket,
    "groupes-electrogenes": GeneratorRecord,
    "fuel-ge": FuelRecord,
    "consommations-groupes-ge": GeneratorFuelConsumption,
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
    "groupeCode": "groupe_code",
    "consommationLitres": "consommation_litres",
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


def _fuel_period_bounds(periode):
    if not periode or not re.fullmatch(r"\d{4}-\d{2}", periode):
        raise ValidationError("La période doit être au format AAAA-MM.")
    try:
        year, month = (int(value) for value in periode.split("-"))
        start = date(year, month, 1)
    except ValueError as error:
        raise ValidationError("La période est invalide.") from error
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _fuel_deliveries_total(site, periode):
    """Retourne le total des livraisons Fuel d'un site sur le mois indiqué."""
    start, end = _fuel_period_bounds(periode)
    result = FuelDelivery.objects.filter(
        site=site,
        date_ravitaillement__gte=start,
        date_ravitaillement__lt=end,
    ).aggregate(total=models.Sum("quantite_recue"))
    return result["total"] or Decimal("0")


def _generator_fuel_consumption_total(site, periode):
    """Retourne la somme des consommations renseignées groupe par groupe pour le mois."""
    _fuel_period_bounds(periode)
    result = GeneratorFuelConsumption.objects.filter(
        site=site,
        periode=periode,
    ).aggregate(total=models.Sum("consommation_litres"))
    return result["total"] or Decimal("0")


def _previous_fuel_final_stock(site, periode):
    """Retourne le stock final du dernier journal Fuel-GE antérieur au mois demandé."""
    _fuel_period_bounds(periode)
    return FuelRecord.objects.filter(
        site=site,
        periode__lt=periode,
    ).order_by("-periode").values_list("stock_final", flat=True).first()


def _generator_hours_total(site, periode):
    """Somme les heures mensuelles des GE; None indique qu'un relevé précédent manque."""
    _fuel_period_bounds(periode)
    current_records = GeneratorRecord.objects.filter(
        site=site,
        mois_releve=periode,
    ).values("code", "rh_actuel")
    if not current_records:
        return None

    total = Decimal("0")
    for current in current_records:
        previous_rh = GeneratorRecord.objects.filter(
            site=site,
            code=current["code"],
            mois_releve__lt=periode,
        ).order_by("-mois_releve").values_list("rh_actuel", flat=True).first()
        if previous_rh is None or current["rh_actuel"] < previous_rh:
            return None
        total += current["rh_actuel"] - previous_rh
    return total

FUEL_AUTOMATIC_FIELDS = {
    "sortie", "entree", "stock_final", "heures_ge", "litres_heure", "disponibilite_grid",
}
FUEL_RECALCULATED_FIELDS = (
    "stock_initial", "sortie", "entree", "stock_final", "heures_ge", "litres_heure", "snel_kwh", "disponibilite_grid",
)


def _assert_fuel_manual_fields_are_not_sent(values, record=None):
    manual_fields = sorted(FUEL_AUTOMATIC_FIELDS.intersection(values))
    if manual_fields:
        raise ValidationError("Les valeurs Fuel-GE calculées automatiquement ne peuvent pas être modifiées manuellement.")
    if record is not None and "stock_initial" in values:
        raise ValidationError("Le stock initial est calculé automatiquement et ne peut plus être modifié.")


def _calculate_fuel_values(values, record=None, allow_initial_stock=False):
    site = values.get("site", getattr(record, "site", None))
    periode = values.get("periode", getattr(record, "periode", None))
    if not site:
        raise ValidationError("Le site est obligatoire.")
    _fuel_period_bounds(periode)
    sortie = _generator_fuel_consumption_total(site, periode)
    values["sortie"] = sortie

    previous_stock = _previous_fuel_final_stock(site, periode)
    if previous_stock is None:
        if record is None:
            if FuelRecord.objects.filter(site=site).exists():
                raise ValidationError("Un journal Fuel-GE existe déjà pour ce site. Le stock de départ ne peut pas être défini sur un mois antérieur.")
            if not allow_initial_stock:
                raise ValidationError("Seul le Manager ou le Chef des opérations peut définir le stock de départ du premier mois.")
        stock_initial = values.get("stock_initial", getattr(record, "stock_initial", None))
        if stock_initial is None:
            raise ValidationError("Le stock initial doit être défini pour le premier mois du site.")
    else:
        stock_initial = previous_stock
    if stock_initial < 0:
        raise ValidationError("Le stock initial ne peut pas être négatif.")

    hours_ge = _generator_hours_total(site, periode)
    if hours_ge is None:
        raise ValidationError("Les relevés RH du mois et du mois précédent sont nécessaires pour calculer les heures GE.")

    entree = _fuel_deliveries_total(site, periode)
    stock_final = stock_initial + entree - sortie
    if stock_final < 0:
        raise ValidationError("La consommation ne peut pas rendre le stock final négatif.")

    values["stock_initial"] = stock_initial
    values["entree"] = entree
    values["heures_ge"] = hours_ge
    values["stock_final"] = stock_final
    if hours_ge > 0:
        values["litres_heure"] = (sortie / hours_ge).quantize(Decimal("0.001"))
    else:
        values["litres_heure"] = Decimal("0") if sortie == 0 else None
    if site in NO_GRID_SITES:
        values["snel_kwh"] = None
        values["disponibilite_grid"] = Decimal("0")
    else:
        year, month = (int(value) for value in periode.split("-"))
        month_hours = Decimal(calendar.monthrange(year, month)[1] * 24)
        availability = (Decimal("1") - (hours_ge / month_hours)) * Decimal("100")
        values["disponibilite_grid"] = max(Decimal("0"), min(Decimal("100"), availability)).quantize(Decimal("0.01"))
    return values


def _recalculate_fuel_records(site, start_period, actor_id=None):
    """Recalcule le mois modifié et tous les mois suivants d'un même site."""
    _fuel_period_bounds(start_period)
    records = FuelRecord.objects.select_for_update().filter(
        site=site,
        periode__gte=start_period,
    ).order_by("periode")
    for fuel_record in records:
        values = {
            "site": fuel_record.site,
            "periode": fuel_record.periode,
            "sortie": fuel_record.sortie,
            "snel_kwh": fuel_record.snel_kwh,
        }
        _calculate_fuel_values(values, fuel_record, allow_initial_stock=True)
        for field in FUEL_RECALCULATED_FIELDS:
            setattr(fuel_record, field, values[field])
        update_fields = [*FUEL_RECALCULATED_FIELDS, "updated_at"]
        if actor_id is not None:
            fuel_record.updated_by = actor_id
            update_fields.append("updated_by")
        fuel_record.full_clean()
        fuel_record.save(update_fields=update_fields)

def _calculate_generator_fuel_consumption(values, record=None):
    site = values.get("site", getattr(record, "site", None))
    periode = values.get("periode", getattr(record, "periode", None))
    groupe_code = values.get("groupe_code", getattr(record, "groupe_code", None))
    consommation = values.get("consommation_litres", getattr(record, "consommation_litres", None))
    if not site or not periode or not groupe_code or consommation is None:
        raise ValidationError("Le site, le mois, le groupe et la consommation sont obligatoires.")
    if consommation < 0:
        raise ValidationError("La consommation ne peut pas être négative.")
    current = GeneratorRecord.objects.filter(
        site=site, code=groupe_code, mois_releve=periode,
    ).values_list("rh_actuel", flat=True).first()
    previous = GeneratorRecord.objects.filter(
        site=site, code=groupe_code, mois_releve__lt=periode,
    ).order_by("-mois_releve").values_list("rh_actuel", flat=True).first()
    if current is None or previous is None or current < previous:
        raise ValidationError("Les relevés RH du groupe pour ce mois et le mois précédent sont nécessaires.")
    hours = current - previous
    if hours == 0 and consommation > 0:
        raise ValidationError("Une consommation positive exige des heures GE supérieures à zéro.")
    values["heures_ge"] = hours
    values["litres_heure"] = (consommation / hours).quantize(Decimal("0.001")) if hours > 0 else Decimal("0")
    return values

def _calculate_fuel_delivery_values(values, record=None):
    quantity = values.get("quantite_recue", getattr(record, "quantite_recue", None))
    stock_before = values.get("stock_avant", getattr(record, "stock_avant", None))
    stock_after = values.get("stock_apres", getattr(record, "stock_apres", None))
    if quantity is None:
        raise ValidationError("La quantité reçue est obligatoire.")
    if quantity < 0 or (stock_before is not None and stock_before < 0) or (stock_after is not None and stock_after < 0):
        raise ValidationError("Les quantités et les stocks ne peuvent pas être négatifs.")
    if stock_before is None:
        values["stock_apres"] = None
        values["difference_stock"] = False
        return values
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
                elif model_class is DatacenterProblem and profile.role not in GLOBAL_ROLES:
                    values["statut"] = "Open"
                elif model_class is GeneratorRecord:
                    _calculate_generator_values(values)
                elif model_class is FuelRecord:
                    _assert_fuel_manual_fields_are_not_sent(values)
                    _calculate_fuel_values(values, allow_initial_stock=profile.role in GLOBAL_ROLES)
                elif model_class is GeneratorFuelConsumption:
                    _calculate_generator_fuel_consumption(values)
                elif model_class is FuelDelivery:
                    _calculate_fuel_delivery_values(values)
                elif model_class is PueRecord:
                    _calculate_pue_values(values)
                record = model_class(**values, created_by=profile.id)
                record.full_clean(exclude=["updated_by"])
                record.save(force_insert=True)
                if model_class is GeneratorRecord:
                    _recalculate_fuel_records(record.site, record.mois_releve, profile.id)
                elif model_class is FuelRecord:
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is GeneratorFuelConsumption:
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is FuelDelivery:
                    _recalculate_fuel_records(record.site, record.date_ravitaillement.strftime("%Y-%m"), profile.id)
                if model_class in {GeneratorRecord, FuelRecord, FuelDelivery, PueRecord}:
                    record.refresh_from_db()
                notify_record_created(profile, resource, record)
                if model_class is GeneratorRecord:
                    notify_generator_alert(profile, record)
            return JsonResponse(_serialize(record), status=201)
        except (ValidationError, PermissionDeniedError) as error:
            return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)
        except IntegrityError:
            return JsonResponse({"status": 409, "code": "duplicate_record", "detail": "Un enregistrement avec ces informations existe déjà."}, status=409)
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
            with transaction.atomic():
                previous_site = record.site
                previous_period = (record.mois_releve if model_class is GeneratorRecord else record.periode if model_class is FuelRecord else record.date_ravitaillement.strftime("%Y-%m") if model_class is FuelDelivery else None)
                if model_class is GeneratorRecord:
                    assert_site_access(profile, values["site"])
                    _calculate_generator_values(values, record)
                elif model_class is FuelRecord:
                    assert_can_modify(profile, values["site"])
                    _assert_fuel_manual_fields_are_not_sent(values, record)
                    _calculate_fuel_values(values, record, allow_initial_stock=profile.role in GLOBAL_ROLES)
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
                record.full_clean()
                record.save()
                if model_class is GeneratorRecord:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.mois_releve, profile.id)
                elif model_class is FuelRecord:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is GeneratorFuelConsumption:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.periode, profile.id)
                elif model_class is FuelDelivery:
                    _recalculate_fuel_records(previous_site, previous_period, profile.id)
                    _recalculate_fuel_records(record.site, record.date_ravitaillement.strftime("%Y-%m"), profile.id)
                if model_class in {GeneratorRecord, FuelRecord, FuelDelivery, PueRecord}:
                    record.refresh_from_db()
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
            deleted_period = record.periode if model_class in {GeneratorFuelConsumption, FuelRecord} else None
            record.delete()
            if deleted_period:
                _recalculate_fuel_records(deleted_site, deleted_period, profile.id)
            return JsonResponse({"status": "deleted", "id": deleted_id})
        return JsonResponse({"detail": "Méthode non autorisée."}, status=405)
    except (ValidationError, PermissionDeniedError) as error:
        return _error(error, 403 if isinstance(error, PermissionDeniedError) else 400)