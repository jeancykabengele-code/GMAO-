"""Journal Fuel-GE : stocks, heures de fonctionnement, consommation par groupe et recalcul des mois."""

import calendar
import re
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from ..models import FuelDelivery, FuelRecord, GeneratorFuelConsumption, GeneratorMonthlyReading, GeneratorRecord, Site
from .serialization import _round_decimal_fields


def _site_is_off_grid(site: str) -> bool:
    connected = Site.objects.filter(name=site).values_list("grid_connected", flat=True).first()
    return connected is False


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
    _fuel_period_bounds(periode)
    result = FuelDelivery.objects.filter(
        site=site,
        periode=periode,
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
    """Somme les heures mensuelles depuis les relevés RH archivés par groupe."""
    _fuel_period_bounds(periode)
    group_codes = list(dict.fromkeys(GeneratorRecord.objects.filter(site=site).values_list("code", flat=True)))
    if not group_codes:
        return None
    current_records = {
        row["groupe_code"]: row["rh_actuel"]
        for row in GeneratorMonthlyReading.objects.filter(site=site, periode=periode).values("groupe_code", "rh_actuel")
    }
    if any(code not in current_records for code in group_codes):
        return None
    total = Decimal("0")
    for code in group_codes:
        previous_rh = GeneratorMonthlyReading.objects.filter(
            site=site, groupe_code=code, periode__lt=periode,
        ).order_by("-periode").values_list("rh_actuel", flat=True).first()
        if previous_rh is None or current_records[code] < previous_rh:
            return None
        total += current_records[code] - previous_rh
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
        site = values.get("site", getattr(record, "site", None))
        periode = values.get("periode", getattr(record, "periode", None))
        if _previous_fuel_final_stock(site, periode) is not None:
            raise ValidationError("Le stock initial est calculé automatiquement : seul le mois le plus ancien du site peut être modifié.")


def _calculate_fuel_values(values, record=None, allow_initial_stock=False):
    site = values.get("site", getattr(record, "site", None))
    periode = values.get("periode", getattr(record, "periode", None))
    if not site:
        raise ValidationError("Le site est obligatoire.")
    _fuel_period_bounds(periode)
    three_places = Decimal("0.001")
    sortie = _generator_fuel_consumption_total(site, periode).quantize(three_places)
    values["sortie"] = sortie

    previous_stock = _previous_fuel_final_stock(site, periode)
    if previous_stock is None:
        # Aucun mois ne précède celui-ci : c'est le mois le plus ancien du site,
        # son stock initial est donc le stock de départ saisi à la main.
        if (record is None or "stock_initial" in values) and not allow_initial_stock:
            raise ValidationError("Seul le Manager ou le Chargé des opérations peut définir le stock de départ du premier mois.")
        stock_initial = values.get("stock_initial", getattr(record, "stock_initial", None))
        if stock_initial is None:
            raise ValidationError("Le stock initial doit être défini pour le premier mois du site.")
        stock_initial = Decimal(stock_initial).quantize(three_places)
    else:
        stock_initial = previous_stock.quantize(three_places)
    if stock_initial < 0:
        raise ValidationError("Le stock initial ne peut pas être négatif.")

    hours_ge = _generator_hours_total(site, periode)
    if hours_ge is None:
        if previous_stock is None and sortie == 0:
            hours_ge = Decimal("0")
        else:
            raise ValidationError("Les relevés RH du mois et du mois précédent sont nécessaires pour calculer les heures GE.")
    hours_ge = hours_ge.quantize(Decimal("0.01"))

    entree = _fuel_deliveries_total(site, periode).quantize(three_places)
    stock_final = (stock_initial + entree - sortie).quantize(three_places)
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
    if _site_is_off_grid(site):
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
        _round_decimal_fields(fuel_record)
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
    current = GeneratorMonthlyReading.objects.filter(
        site=site, groupe_code=groupe_code, periode=periode,
    ).values_list("rh_actuel", flat=True).first()
    previous = GeneratorMonthlyReading.objects.filter(
        site=site, groupe_code=groupe_code, periode__lt=periode,
    ).order_by("-periode").values_list("rh_actuel", flat=True).first()
    if current is None or previous is None or current < previous:
        raise ValidationError("Les relevés RH du groupe pour ce mois et le mois précédent sont nécessaires.")
    hours = current - previous
    if hours == 0 and consommation > 0:
        raise ValidationError("Une consommation positive exige des heures GE supérieures à zéro.")
    values["heures_ge"] = hours
    values["litres_heure"] = (consommation / hours).quantize(Decimal("0.001")) if hours > 0 else Decimal("0")
    return values


def _recalculate_fuel_records_after_reading_change(site, periode, actor_id=None):
    try:
        _recalculate_fuel_records(site, periode, actor_id)
    except ValidationError as error:
        if not any("relevés RH" in message for message in error.messages):
            raise
