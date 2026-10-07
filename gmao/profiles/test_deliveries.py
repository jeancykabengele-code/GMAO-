"""Ravitaillements Fuel : mois, rang et recalcul."""

import json
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from . import models as business_models
from .records.deliveries import _recalculate_fuel_records_after_delivery_change
from .records.fuel import _fuel_deliveries_total


class FuelDeliveryRecalculationTests(SimpleTestCase):
    @patch("profiles.records.deliveries._recalculate_fuel_records", side_effect=ValidationError("Les relevés RH du mois et du mois précédent sont nécessaires pour calculer les heures GE."))
    def test_delivery_change_is_kept_when_generator_readings_are_missing(self, recalculate):
        _recalculate_fuel_records_after_delivery_change("Goma", "2026-02", uuid4())
        recalculate.assert_called_once()


class FuelDeliveryMonthAndRankTests(TestCase):
    """Un ravitaillement est rattaché à un mois et à un rang (1er à 5e), sans date."""

    def _create(self, **overrides):
        values = {
            "site": "Goma", "created_by": uuid4(), "fournisseur": "X", "bon_livraison": "BL", "type_carburant": "Diesel",
            "quantite_recue": Decimal("100"), "receptionne_par": "Agent", "periode": "2026-01", "rang": 1,
        }
        values.update(overrides)
        return business_models.FuelDelivery.objects.create(**values)

    def test_total_adds_every_delivery_of_the_month_and_ignores_missing_ranks(self):
        self._create(rang=1, quantite_recue=Decimal("100.5"))
        self._create(rang=3, quantite_recue=Decimal("200"))
        self._create(periode="2026-02", rang=1, quantite_recue=Decimal("999"))
        self.assertEqual(_fuel_deliveries_total("Goma", "2026-01"), Decimal("300.500"))
        self.assertEqual(_fuel_deliveries_total("Goma", "2026-03"), Decimal("0"))

    def test_next_free_rank_is_assigned_and_five_is_the_maximum(self):
        from .records.deliveries import _assign_delivery_period_and_rank
        for rank in range(1, 6):
            values = {"site": "Goma", "periode": "2026-01"}
            _assign_delivery_period_and_rank(values)
            self.assertEqual(values["rang"], rank)
            self._create(rang=rank)
        with self.assertRaises(ValidationError):
            _assign_delivery_period_and_rank({"site": "Goma", "periode": "2026-01"})

    def test_rank_must_be_between_one_and_five_and_unique_for_the_month(self):
        from .records.deliveries import _assign_delivery_period_and_rank
        self._create(rang=2)
        for bad in (0, 6):
            with self.assertRaises(ValidationError):
                _assign_delivery_period_and_rank({"site": "Goma", "periode": "2026-01", "rang": bad})
        with self.assertRaises(ValidationError) as error:
            _assign_delivery_period_and_rank({"site": "Goma", "periode": "2026-01", "rang": 2})
        self.assertIn("existe déjà", str(error.exception))
        existing = business_models.FuelDelivery.objects.get(rang=2)
        _assign_delivery_period_and_rank({"site": "Goma", "periode": "2026-01", "rang": 2}, existing)

    def test_month_is_required_and_old_date_still_gives_the_month(self):
        from .records.deliveries import _assign_delivery_period_and_rank
        with self.assertRaises(ValidationError):
            _assign_delivery_period_and_rank({"site": "Goma"})
        values = {"site": "Goma", "date_ravitaillement": date(2026, 3, 15)}
        _assign_delivery_period_and_rank(values)
        self.assertEqual((values["periode"], values["rang"]), ("2026-03", 1))

    @patch("profiles.views.profile_from_token")
    def test_creating_a_delivery_through_the_api_updates_the_fuel_journal(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        business_models.FuelRecord.objects.create(
            site="Goma", created_by=uuid4(), periode="2026-01", stock_initial=Decimal("1000"), entree=Decimal("0"),
            sortie=Decimal("0"), stock_final=Decimal("1000"), heures_ge=Decimal("0"), litres_heure=Decimal("0"),
            snel_kwh=Decimal("0"), disponibilite_grid=Decimal("100"),
        )
        response = self.client.post(
            "/api/records/fuel-ravitaillements",
            data=json.dumps({
                "site": "Goma", "periode": "2026-01", "rang": 2, "fournisseur": "X", "bonLivraison": "BL",
                "typeCarburant": "Diesel", "quantiteRecue": 250.5, "receptionnePar": "Agent",
            }),
            content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["periode"], "2026-01")
        self.assertEqual(response.json()["rang"], 2)
        self.assertIsNone(response.json().get("dateRavitaillement"))
        journal = business_models.FuelRecord.objects.get(site="Goma", periode="2026-01")
        self.assertEqual(journal.entree, Decimal("250.500"))
        self.assertEqual(journal.stock_final, Decimal("1250.500"))
