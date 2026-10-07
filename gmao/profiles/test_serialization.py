"""Nettoyage et précision des valeurs reçues."""

from decimal import Decimal

from django.test import SimpleTestCase

from . import models as business_models
from .records.serialization import _clean_values


class CleanValuesDecimalPrecisionTests(SimpleTestCase):
    """DecimalField.to_python() converts a JSON float through a binary
    approximation (e.g. 1000.1 -> Decimal('1000.100000000000')), which then
    fails the field's own decimal_places validation on full_clean(). The
    payload cleaner must round every decimal field back to what it allows."""

    def test_rounds_a_float_with_trailing_binary_noise_to_the_field_precision(self):
        values = _clean_values(business_models.FuelRecord, {
            "site": "Goma", "periode": "2026-01", "stockInitial": 1000.1, "snelKwh": 10,
        })
        self.assertEqual(values["stock_initial"], Decimal("1000.100"))
        self.assertEqual(values["stock_initial"].as_tuple().exponent, -3)

    def test_rounds_several_non_exact_binary_fractions_across_models(self):
        pue_values = _clean_values(business_models.PueRecord, {
            "site": "Goma", "mois": "2026-01", "energieIt": 999.999, "energieTotale": 500.123,
        })
        self.assertEqual(pue_values["energie_it"], Decimal("999.999"))
        self.assertEqual(pue_values["energie_totale"], Decimal("500.123"))

        consumption_values = _clean_values(business_models.GeneratorFuelConsumption, {
            "site": "Goma", "periode": "2026-01", "groupeCode": "DC-GOM-GE-001", "consommationLitres": 120.456,
        })
        self.assertEqual(consumption_values["consommation_litres"], Decimal("120.456"))
