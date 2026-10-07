"""Calcul du PUE."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from .records.pue import _calculate_pue_values


class PueCalculationTests(SimpleTestCase):
    def test_calculates_pue_to_three_decimals(self):
        values = _calculate_pue_values({
            "energie_it": Decimal("26203"),
            "energie_totale": Decimal("46856"),
        })
        self.assertEqual(values["pue"], Decimal("1.788"))

    def test_rejects_total_energy_lower_than_it_energy(self):
        with self.assertRaises(ValidationError):
            _calculate_pue_values({
                "energie_it": Decimal("100"),
                "energie_totale": Decimal("90"),
            })
