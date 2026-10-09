"""Calcul du PUE à partir du relevé journalier de DC Pigeon."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from . import models as business_models
from .records.pue import LINES_BY_CODE, PUE_LINES, SITE_TIMEZONE, _calculate_pue_values, _compute_lines
from .records.serialization import _history_snapshot

KINSHASA = SITE_TIMEZONE


def at(hour, minute=0, day=12):
    """Instant donné en heure de Kinshasa, tel que le serveur le reçoit (UTC)."""
    return datetime(2026, 10, day, hour, minute, tzinfo=KINSHASA).astimezone(timezone.utc)


def full_reading(**overrides):
    """Un relevé complet : tout en kW lus, TGBT A + B = 100 kW pour 80 kW d'IT (PUE 1,25)."""
    kw = {
        "ups_a": 30, "ups_b": 20, "redresseurs_a": 15, "redresseurs_b": 15,
        "clim_a": 8, "clim_b": 8, "tertiaire": 4, "tgbt_a": 52, "tgbt_b": 48,
    }
    for line in PUE_LINES:
        kw.setdefault(line.code, 5)
    kw.update(overrides)
    return {code: {"kwLus": value} for code, value in kw.items()}


class PueLineConversionTests(SimpleTestCase):
    def test_dc_line_uses_volts_times_amps(self):
        computed = _compute_lines(full_reading(redresseurs_a=None) | {"redresseurs_a": {"a": 1000, "v": 53.5}})
        self.assertEqual(computed["redresseurs_a"]["kw"], 53.5)
        self.assertEqual(computed["redresseurs_a"]["origine"], "Calculé")

    def test_ac_line_uses_three_phase_formula_with_default_voltage_and_power_factor(self):
        computed = _compute_lines(full_reading() | {"ups_a": {"a": 700}})
        # √3 × 400 V × 700 A × 0,9 ÷ 1000
        self.assertAlmostEqual(computed["ups_a"]["kw"], 436.477, places=3)

    def test_ac_line_uses_the_entered_voltage(self):
        computed = _compute_lines(full_reading() | {"ups_a": {"a": 100, "v": 230}})
        self.assertAlmostEqual(computed["ups_a"]["kw"], 35.853, places=3)

    def test_read_kw_take_priority_and_the_gap_with_the_calculation_is_reported(self):
        computed = _compute_lines(full_reading() | {"redresseurs_a": {"kwLus": 55, "a": 1000, "v": 50}})
        line = computed["redresseurs_a"]
        self.assertEqual((line["kw"], line["origine"], line["ecart"]), (55.0, "Lu", 10.0))

    def test_dc_amps_without_volts_are_rejected(self):
        with self.assertRaisesMessage(ValidationError, "Redresseurs A : la tension (V) est obligatoire"):
            _compute_lines(full_reading() | {"redresseurs_a": {"a": 1000}})

    def test_every_equipment_must_be_read(self):
        reading = full_reading()
        del reading["pdf_dc_b4"]
        with self.assertRaisesMessage(ValidationError, "PDF DC B4"):
            _compute_lines(reading)

    def test_unknown_equipment_and_negative_values_are_rejected(self):
        with self.assertRaises(ValidationError):
            _compute_lines(full_reading() | {"serveur_x": {"kwLus": 1}})
        with self.assertRaises(ValidationError):
            _compute_lines(full_reading() | {"ups_a": {"kwLus": -3}})

    def test_the_sheet_lists_the_21_equipments_of_the_single_line_diagram(self):
        self.assertEqual(len(PUE_LINES), 21)
        self.assertEqual(len(LINES_BY_CODE), 21)


class PueDailyReadingTests(TestCase):
    def values(self, **overrides):
        return {"site": "Pigeon", "mesures": full_reading(**overrides)}

    def test_pue_is_total_over_it_and_the_date_comes_from_the_server_clock(self):
        values = _calculate_pue_values(self.values(), now=at(11, 30))
        self.assertEqual(values["it_kw"], Decimal("80.000"))
        self.assertEqual(values["total_kw"], Decimal("100.000"))
        self.assertEqual(values["pue"], Decimal("1.250"))
        self.assertEqual(str(values["date_releve"]), "2026-10-12")
        self.assertEqual(str(values["heure_releve"]), "11:30:00")

    def test_pdf_cooling_and_tertiary_lines_do_not_change_the_pue(self):
        base = _calculate_pue_values(self.values(), now=at(11))
        changed = _calculate_pue_values(self.values(pdf_dc_a1=40, clim_a=99), now=at(11))
        self.assertEqual(base["pue"], changed["pue"])

    def test_window_is_10h_to_13h_kinshasa_time(self):
        for hour, minute in ((10, 0), (12, 59)):
            self.assertEqual(_calculate_pue_values(self.values(), now=at(hour, minute))["pue"], Decimal("1.250"))
        for hour, minute in ((9, 59), (13, 0), (20, 0)):
            with self.subTest(hour=hour, minute=minute):
                with self.assertRaisesMessage(ValidationError, "entre 10h00 et 13h00"):
                    _calculate_pue_values(self.values(), now=at(hour, minute))

    def test_window_is_evaluated_in_kinshasa_time_not_utc(self):
        # 10h00 à Kinshasa = 09h00 UTC
        self.assertEqual(at(10).hour, 9)
        _calculate_pue_values(self.values(), now=at(10))

    def test_one_reading_per_day(self):
        values = _calculate_pue_values(self.values(), now=at(11))
        business_models.PueRecord.objects.create(created_by=uuid4(), **values)
        with self.assertRaisesMessage(ValidationError, "existe déjà"):
            _calculate_pue_values(self.values(), now=at(12))
        self.assertEqual(_calculate_pue_values(self.values(), now=at(11, 0, day=13))["pue"], Decimal("1.250"))

    def test_only_pigeon_is_supported(self):
        with self.assertRaisesMessage(ValidationError, "uniquement pour le site Pigeon"):
            _calculate_pue_values({"site": "Goma", "mesures": full_reading()}, now=at(11))

    def test_total_below_it_is_rejected(self):
        with self.assertRaisesMessage(ValidationError, "inférieure à la puissance IT"):
            _calculate_pue_values(self.values(tgbt_a=10, tgbt_b=10), now=at(11))

    def test_correction_keeps_the_original_date_and_ignores_the_window(self):
        created = _calculate_pue_values(self.values(), now=at(11))
        record = business_models.PueRecord.objects.create(created_by=uuid4(), **created)
        update = {"site": "Pigeon", "mesures": full_reading(tgbt_a=62), "date_releve": "2030-01-01"}
        values = _calculate_pue_values(update, record)
        self.assertNotIn("date_releve", values)
        self.assertEqual(values["pue"], Decimal("1.375"))

    def test_history_snapshot_lists_the_retained_kw_of_each_line(self):
        values = _calculate_pue_values(self.values(), now=at(11))
        record = business_models.PueRecord(created_by=uuid4(), **values)
        snapshot = _history_snapshot(record)
        self.assertNotIn("mesures", snapshot)
        self.assertEqual(snapshot["kw_tgbt_a"], 52.0)
        self.assertEqual(snapshot["dateReleve"], "2026-10-12")
