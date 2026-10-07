"""Ravitaillements Fuel : mois, rang (1er à 5e) et impact sur le journal."""

from decimal import Decimal

from django.core.exceptions import ValidationError

from ..models import FuelDelivery, MAX_DELIVERIES_PER_MONTH
from .fuel import _fuel_period_bounds, _recalculate_fuel_records


def _recalculate_fuel_records_after_delivery_change(site, periode, actor_id=None):
    """Recalcule Fuel-GE sans empêcher une livraison historique si les RH manquent."""
    try:
        _recalculate_fuel_records(site, periode, actor_id)
    except ValidationError as error:
        if not any("relevés RH" in message for message in error.messages):
            raise


def _assign_delivery_period_and_rank(values, record=None):
    """Fixe le mois et le rang (1er à 5e) du ravitaillement ; l'ancienne date reste acceptée et en donne le mois."""
    site = values.get("site", getattr(record, "site", None))
    delivery_date = values.get("date_ravitaillement")
    periode = values.get("periode") or (delivery_date.strftime("%Y-%m") if delivery_date else getattr(record, "periode", None))
    if not periode:
        raise ValidationError("Le mois du ravitaillement est obligatoire.")
    _fuel_period_bounds(periode)
    rang = values.get("rang", getattr(record, "rang", None))
    taken = FuelDelivery.objects.filter(site=site, periode=periode)
    if record is not None:
        taken = taken.exclude(id=record.id)
    used = set(taken.values_list("rang", flat=True))
    if rang in (None, ""):
        rang = next((number for number in range(1, MAX_DELIVERIES_PER_MONTH + 1) if number not in used), None)
        if rang is None:
            raise ValidationError(f"Ce site a déjà {MAX_DELIVERIES_PER_MONTH} ravitaillements pour ce mois.")
    rang = int(rang)
    if not 1 <= rang <= MAX_DELIVERIES_PER_MONTH:
        raise ValidationError(f"Le numéro du ravitaillement doit être compris entre 1 et {MAX_DELIVERIES_PER_MONTH}.")
    if rang in used:
        raise ValidationError(f"Le ravitaillement n° {rang} existe déjà pour ce site et ce mois.")
    values["periode"] = periode
    values["rang"] = rang


def _calculate_fuel_delivery_values(values, record=None):
    _assign_delivery_period_and_rank(values, record)
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
