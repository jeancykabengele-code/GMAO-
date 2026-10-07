"""Journal Fuel-GE : calculs, stocks et recalculs."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from . import models as business_models
from .records.deliveries import _calculate_fuel_delivery_values
from .records.fuel import _assert_fuel_manual_fields_are_not_sent, _calculate_fuel_values, _fuel_deliveries_total, _generator_hours_total, _previous_fuel_final_stock, _recalculate_fuel_records


class HistoricalFuelDeliveryTests(SimpleTestCase):
    @patch("profiles.records.deliveries._assign_delivery_period_and_rank")
    def test_historical_delivery_can_keep_unknown_stocks_empty(self, assign_period):
        values = _calculate_fuel_delivery_values({
            "quantite_recue": Decimal("1250.500"),
            "stock_avant": None,
            "stock_apres": None,
        })

        self.assertIsNone(values["stock_apres"])
        self.assertFalse(values["difference_stock"])


class FuelCalculationTests(TestCase):
    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("24"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("100"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("300"))
    def test_calculates_automatic_values_litres_per_hour_and_grid_availability(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values({
            "site": "Goma",
            "periode": "2026-01",
            "sortie": Decimal("300"),
            "snel_kwh": Decimal("4500"),
        })

        self.assertEqual(values["stock_initial"], Decimal("500"))
        self.assertEqual(values["entree"], Decimal("100"))
        self.assertEqual(values["stock_final"], Decimal("300"))
        self.assertEqual(values["heures_ge"], Decimal("24"))
        self.assertEqual(values["litres_heure"], Decimal("12.500"))
        self.assertEqual(values["disponibilite_grid"], Decimal("96.77"))

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("10"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("100"))
    def test_no_grid_sites_have_zero_availability_and_no_snel(self, group_consumption, previous_stock, deliveries, generator_hours):
        business_models.Site.objects.create(name="Kikwit", code="KKW", active=True, grid_connected=False)
        values = _calculate_fuel_values({
            "site": "Kikwit",
            "periode": "2026-01",
            "sortie": Decimal("100"),
            "snel_kwh": Decimal("999"),
        })

        self.assertEqual(values["disponibilite_grid"], Decimal("0"))
        self.assertIsNone(values["snel_kwh"])

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("253"))
    def test_positive_consumption_with_zero_hours_is_not_calculable(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values({
            "site": "Pigeon",
            "periode": "2026-05",
            "sortie": Decimal("253"),
            "snel_kwh": Decimal("320544"),
        })

        self.assertIsNone(values["litres_heure"])

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("50"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("300"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("1000"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("200"))
    def test_realistic_february_scenario_calculates_fuel_ge_values(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values({
            "site": "Goma",
            "periode": "2026-02",
            "sortie": Decimal("200"),
            "snel_kwh": Decimal("4200"),
        })

        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["entree"], Decimal("300"))
        self.assertEqual(values["stock_final"], Decimal("1100"))
        self.assertEqual(values["heures_ge"], Decimal("50"))
        self.assertEqual(values["litres_heure"], Decimal("4.000"))
        self.assertEqual(values["disponibilite_grid"], Decimal("92.56"))
    @patch("profiles.records.fuel._generator_hours_total", return_value=None)
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("10"))
    def test_rejects_save_when_generator_hours_cannot_be_calculated(self, group_consumption, previous_stock, deliveries, generator_hours):
        with self.assertRaises(ValidationError):
            _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "sortie": Decimal("10")})

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("20"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("100"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("50"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("151"))
    def test_rejects_consumption_that_makes_automatic_final_stock_negative(self, group_consumption, previous_stock, deliveries, generator_hours):
        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "sortie": Decimal("151")})
        self.assertIn("stock final négatif", str(error.exception))

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("12.3333333333"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("100.000000000001"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500.100000000000"))
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("300.000000000002"))
    def test_rounds_noisy_aggregate_totals_to_the_field_precision(self, group_consumption, previous_stock, deliveries, generator_hours):
        """A DB driver or aggregate that hands back more precision than the
        FuelRecord columns allow (e.g. a SUM() carrying binary float noise)
        must not make full_clean() reject the record afterwards."""
        values = _calculate_fuel_values({
            "site": "Goma", "periode": "2026-01", "sortie": Decimal("300.000000000002"),
        })
        for field in ("stock_initial", "entree", "sortie", "stock_final"):
            self.assertGreaterEqual(values[field].as_tuple().exponent, -3, field)
        self.assertGreaterEqual(values["heures_ge"].as_tuple().exponent, -2)
        self.assertEqual(values["stock_initial"], Decimal("500.100"))
        self.assertEqual(values["entree"], Decimal("100.000"))
        self.assertEqual(values["stock_final"], Decimal("300.100"))
        self.assertEqual(values["heures_ge"], Decimal("12.33"))

    @patch("profiles.models.FuelRecord.objects")
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_chef_site_cannot_define_initial_fuel_stock(self, group_consumption, previous_stock, fuel_objects):
        fuel_objects.filter.return_value.exists.return_value = False

        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values(
                {"site": "Goma", "periode": "2026-01", "sortie": Decimal("0"), "stock_initial": Decimal("1000")},
                allow_initial_stock=False,
            )

        self.assertIn("Seul le Manager", str(error.exception))

    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("150"))
    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("30"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("200"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    def test_two_groups_scenario_recalculates_the_site_fuel_totals(self, previous_stock, deliveries, generator_hours, group_total):
        values = _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "snel_kwh": Decimal("4200")})

        self.assertEqual(values["sortie"], Decimal("150"))
        self.assertEqual(values["stock_final"], Decimal("550"))
        self.assertEqual(values["litres_heure"], Decimal("5.000"))

    def test_rejects_manual_values_that_are_calculated_automatically(self):
        with self.assertRaises(ValidationError) as error:
            _assert_fuel_manual_fields_are_not_sent({"site": "Goma", "sortie": Decimal("100")})
        self.assertIn("calculées automatiquement", str(error.exception))

    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=Decimal("500"))
    def test_rejects_manual_initial_stock_on_an_existing_journal(self, previous_stock):
        with self.assertRaises(ValidationError) as error:
            _assert_fuel_manual_fields_are_not_sent(
                {"site": "Goma", "stock_initial": Decimal("1000")},
                SimpleNamespace(site="Goma", periode="2026-02", stock_initial=Decimal("1000")),
            )
        self.assertIn("stock initial", str(error.exception))

    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    def test_allows_manual_initial_stock_on_the_oldest_journal(self, previous_stock):
        _assert_fuel_manual_fields_are_not_sent(
            {"site": "Goma", "stock_initial": Decimal("1000")},
            SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900")),
        )

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_oldest_journal_initial_stock_can_be_corrected(self, group_consumption, previous_stock, deliveries, generator_hours):
        record = SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900"))
        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2026-01", "stock_initial": Decimal("1000")}, record, allow_initial_stock=True,
        )
        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("1000"))

    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_oldest_journal_initial_stock_correction_needs_permission(self, group_consumption, previous_stock):
        record = SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900"))
        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values(
                {"site": "Goma", "periode": "2026-01", "stock_initial": Decimal("1000")}, record, allow_initial_stock=False,
            )
        self.assertIn("Seul le Manager", str(error.exception))
    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.models.FuelRecord.objects")
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("100"))
    def test_global_role_can_define_initial_fuel_stock_once(self, group_consumption, previous_stock, fuel_objects, deliveries, generator_hours):
        fuel_objects.filter.return_value.exists.return_value = False

        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2026-01", "sortie": Decimal("100"), "stock_initial": Decimal("1000")},
            allow_initial_stock=True,
        )

        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("900"))

    @patch("profiles.records.fuel._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.fuel._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records.fuel._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_can_define_an_initial_stock_on_an_earlier_month(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2025-12", "sortie": Decimal("0"), "stock_initial": Decimal("1000")},
            allow_initial_stock=True,
        )
        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("1000"))


class FuelRecalculationTests(SimpleTestCase):
    @patch("profiles.records.fuel._calculate_fuel_values")
    @patch("profiles.models.FuelRecord.objects")
    def test_recalculates_the_changed_month_and_persists_automatic_values(self, fuel_objects, calculate):
        record = MagicMock()
        record.site = "Goma"
        record.periode = "2026-03"
        record.sortie = Decimal("120")
        record.snel_kwh = Decimal("3000")
        record.stock_initial = Decimal("500")
        fuel_objects.select_for_update.return_value.filter.return_value.order_by.return_value = [record]

        def calculate_values(values, *_args, **_kwargs):
            values.update({
                "stock_initial": Decimal("500"), "entree": Decimal("200"),
                "stock_final": Decimal("580"), "heures_ge": Decimal("24"),
                "litres_heure": Decimal("5"), "snel_kwh": Decimal("3000"),
                "disponibilite_grid": Decimal("96"),
            })

        calculate.side_effect = calculate_values
        actor_id = uuid4()
        _recalculate_fuel_records("Goma", "2026-03", actor_id)

        self.assertEqual(record.entree, Decimal("200"))
        self.assertEqual(record.stock_final, Decimal("580"))
        self.assertEqual(record.updated_by, actor_id)
        record.save.assert_called_once()


class FuelAutomaticInputsTests(SimpleTestCase):
    @patch("profiles.models.FuelDelivery.objects")
    def test_sums_deliveries_for_the_site_and_month(self, delivery_objects):
        delivery_objects.filter.return_value.aggregate.return_value = {"total": Decimal("1250.500")}

        total = _fuel_deliveries_total("Goma", "2026-02")

        self.assertEqual(total, Decimal("1250.500"))
        delivery_objects.filter.assert_called_once_with(site="Goma", periode="2026-02")

    @patch("profiles.models.FuelDelivery.objects")
    def test_returns_zero_when_no_delivery_exists(self, delivery_objects):
        delivery_objects.filter.return_value.aggregate.return_value = {"total": None}
        self.assertEqual(_fuel_deliveries_total("Goma", "2026-02"), Decimal("0"))

    @patch("profiles.models.FuelRecord.objects")
    def test_reads_the_previous_month_final_stock(self, fuel_objects):
        fuel_objects.filter.return_value.order_by.return_value.values_list.return_value.first.return_value = Decimal("2650")

        stock = _previous_fuel_final_stock("Goma", "2026-02")

        self.assertEqual(stock, Decimal("2650"))
        fuel_objects.filter.assert_called_once_with(site="Goma", periode__lt="2026-02")

    @patch("profiles.models.GeneratorMonthlyReading.objects")
    @patch("profiles.models.GeneratorRecord.objects")
    def test_sums_monthly_hours_from_each_generator_counter(self, generator_objects, reading_objects):
        generator_objects.filter.return_value.values_list.return_value = ["DC-GOM-GE-001", "DC-GOM-GE-002"]
        current = MagicMock()
        current.values.return_value = [
            {"groupe_code": "DC-GOM-GE-001", "rh_actuel": Decimal("220")},
            {"groupe_code": "DC-GOM-GE-002", "rh_actuel": Decimal("130")},
        ]
        previous_one = MagicMock()
        previous_one.order_by.return_value.values_list.return_value.first.return_value = Decimal("200")
        previous_two = MagicMock()
        previous_two.order_by.return_value.values_list.return_value.first.return_value = Decimal("100")
        reading_objects.filter.side_effect = [current, previous_one, previous_two]
        self.assertEqual(_generator_hours_total("Goma", "2026-02"), Decimal("50"))

    @patch("profiles.models.GeneratorMonthlyReading.objects")
    @patch("profiles.models.GeneratorRecord.objects")
    def test_returns_none_when_a_previous_generator_reading_is_missing(self, generator_objects, reading_objects):
        generator_objects.filter.return_value.values_list.return_value = ["DC-GOM-GE-001"]
        current = MagicMock()
        current.values.return_value = [{"groupe_code": "DC-GOM-GE-001", "rh_actuel": Decimal("220")}]
        previous = MagicMock()
        previous.order_by.return_value.values_list.return_value.first.return_value = None
        reading_objects.filter.side_effect = [current, previous]
        self.assertIsNone(_generator_hours_total("Goma", "2026-02"))
