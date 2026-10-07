"""Groupes électrogènes : codes, PM et consommation."""

import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from . import models as business_models
from .records.equipment import _next_equipment_code
from .records.fuel import _generator_fuel_consumption_total
from .records.generators import _calculate_generator_values


class EquipmentCodeTests(SimpleTestCase):
    def test_generates_next_equipment_code_from_site_code(self):
        code = _next_equipment_code(
            "GOM",
            ["EQ-GOM-0001", "EQ-GOM-0003", "ANCIEN-CODE"],
        )

        self.assertEqual(code, "EQ-GOM-0004")


class GeneratorPmCalculationTests(SimpleTestCase):
    def calculate(self, hours_since_pm, delayed=False):
        return _calculate_generator_values({
            "rh_actuel": Decimal("1000") + Decimal(str(hours_since_pm)),
            "rh_derniere_pm": Decimal("1000"),
            "retard_signale": delayed,
        })

    def test_calculates_hours_next_pm_and_thresholds(self):
        normal = self.calculate("174.99")
        watch = self.calculate("175")
        urgent = self.calculate("225")
        exceeded = self.calculate("250")

        self.assertEqual(normal["rh_depuis_derniere_pm"], Decimal("174.99"))
        self.assertEqual(normal["rh_prochaine_pm"], Decimal("1250"))
        self.assertEqual(normal["etat"], "Normal")
        self.assertEqual(watch["etat"], "ASurveiller")
        self.assertEqual(urgent["etat"], "PmUrgente")
        self.assertEqual(exceeded["etat"], "PmDepassee")

    def test_reported_delay_forces_watch_state(self):
        self.assertEqual(self.calculate("10", delayed=True)["etat"], "ASurveiller")

    def test_current_meter_cannot_be_lower_than_last_pm(self):
        with self.assertRaises(ValidationError):
            _calculate_generator_values({
                "rh_actuel": Decimal("99"),
                "rh_derniere_pm": Decimal("100"),
                "retard_signale": False,
            })


class GeneratorConsumptionControlTests(SimpleTestCase):
    @patch("profiles.models.GeneratorFuelConsumption.objects")
    def test_monthly_total_comes_from_all_groups_of_the_site(self, consumption_objects):
        consumption_objects.filter.return_value.aggregate.return_value = {"total": Decimal("150")}

        total = _generator_fuel_consumption_total("Goma", "2026-02")

        self.assertEqual(total, Decimal("150"))
        consumption_objects.filter.assert_called_once_with(site="Goma", periode="2026-02")

    def test_one_group_is_unique_per_site_and_month(self):
        from .models import GeneratorFuelConsumption
        self.assertIn(("site", "periode", "groupe_code"), GeneratorFuelConsumption._meta.unique_together)


class GeneratorConsumptionUpdateTests(TestCase):
    """Régression : modifier une consommation par GE recalculait Fuel-GE avec une période vide."""

    @patch("profiles.views.profile_from_token")
    def test_updating_a_consumption_recalculates_fuel_ge(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        site = "Goma"
        business_models.GeneratorRecord.objects.create(
            site=site, code="GE-01", type_ge="GE", mois_releve="2026-01", rh_actuel=130, rh_derniere_pm=0,
            rh_depuis_derniere_pm=130, rh_prochaine_pm=250, etat="Normal", created_by=uuid4(),
        )
        for periode, rh in (("2025-12", 100), ("2026-01", 130)):
            business_models.GeneratorMonthlyReading.objects.create(
                site=site, periode=periode, groupe_code="GE-01", rh_actuel=rh, created_by=uuid4(),
            )
        consumption = business_models.GeneratorFuelConsumption.objects.create(
            site=site, periode="2026-01", groupe_code="GE-01", consommation_litres=200, heures_ge=30,
            litres_heure=Decimal("6.667"), created_by=uuid4(),
        )

        response = self.client.put(
            f"/api/records/consommations-groupes-ge/{consumption.id}",
            data=json.dumps({"site": site, "periode": "2026-01", "groupeCode": "GE-01", "consommationLitres": 210.5}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer valid-token",
        )

        self.assertEqual(response.status_code, 200, response.content)
        consumption.refresh_from_db()
        self.assertEqual(consumption.consommation_litres, Decimal("210.500"))
