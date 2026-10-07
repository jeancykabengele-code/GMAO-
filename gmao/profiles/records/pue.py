"""Calcul du PUE."""

from decimal import Decimal

from django.core.exceptions import ValidationError


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
