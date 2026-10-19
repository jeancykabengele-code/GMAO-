"""Calcul du PUE à partir du relevé journalier de DC Pigeon."""

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
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


def compute(mesures, scenario="S1"):
    return _compute_lines(mesures, scenario)


def full_reading(**overrides):
    """Un relevé complet : tout en kW lus, TGBT A + B = 100 kW, IT = 80 kW, hors IT = 20 kW (PUE 1,25)."""
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
        computed = compute(full_reading(redresseurs_a=None) | {"redresseurs_a": {"a": 1000, "v": 53.5}})
        self.assertEqual(computed["redresseurs_a"]["kw"], 53.5)
        self.assertEqual(computed["redresseurs_a"]["origine"], "Calculé")

    def test_ac_line_uses_three_phase_formula_with_default_voltage_and_power_factor(self):
        computed = compute(full_reading() | {"ups_a": {"a": 700}})
        # √3 × 400 V × 700 A × 0,9 ÷ 1000
        self.assertAlmostEqual(computed["ups_a"]["kw"], 436.477, places=3)

    def test_ac_line_uses_the_power_factor_read_on_the_equipment(self):
        computed = compute(full_reading() | {"ups_a": {"a": 700, "cosPhi": 0.95}})
        # √3 × 400 V × 700 A × 0,95 ÷ 1000
        self.assertAlmostEqual(computed["ups_a"]["kw"], 460.726, places=3)
        self.assertEqual(computed["ups_a"]["cosPhi"], 0.95)

    def test_missing_power_factor_falls_back_to_the_default(self):
        computed = compute(full_reading() | {"ups_a": {"a": 700, "cosPhi": None}})
        self.assertAlmostEqual(computed["ups_a"]["kw"], 436.477, places=3)
        self.assertIsNone(computed["ups_a"]["cosPhi"])

    def test_power_factor_must_be_between_zero_and_one(self):
        for bad in (0, 1.2, -0.5):
            with self.subTest(cos_phi=bad), self.assertRaisesMessage(ValidationError, "cos φ"):
                compute(full_reading() | {"ups_a": {"a": 700, "cosPhi": bad}})

    def test_power_factor_is_ignored_on_dc_lines(self):
        computed = compute(full_reading() | {"redresseurs_a": {"a": 1000, "v": 53.5, "cosPhi": 0.5}})
        self.assertEqual(computed["redresseurs_a"]["kw"], 53.5)
        self.assertIsNone(computed["redresseurs_a"]["cosPhi"])

    def test_ac_line_uses_the_entered_voltage(self):
        computed = compute(full_reading() | {"ups_a": {"a": 100, "v": 230}})
        self.assertAlmostEqual(computed["ups_a"]["kw"], 35.853, places=3)

    def test_read_kw_take_priority_and_the_gap_with_the_calculation_is_reported(self):
        computed = compute(full_reading() | {"redresseurs_a": {"kwLus": 55, "a": 1000, "v": 50}})
        line = computed["redresseurs_a"]
        self.assertEqual((line["kw"], line["origine"], line["ecart"]), (55.0, "Lu", 10.0))

    def test_dc_amps_without_volts_are_rejected(self):
        with self.assertRaisesMessage(ValidationError, "Redresseurs A : la tension (V) est obligatoire"):
            compute(full_reading() | {"redresseurs_a": {"a": 1000}})

    def test_each_scenario_requires_its_own_measured_lines(self):
        required = {
            "S1": (("tgbt_b", "TGBT B"), ("ups_a", "UPS A"), ("redresseurs_b", "Redresseurs B")),
            "S2": (("clim_a", "TDBT Climatisation A"), ("tertiaire", "Charges tertiaires"), ("ups_b", "UPS B")),
        }
        for scenario, lines in required.items():
            for code, label in lines:
                with self.subTest(scenario=scenario, code=code):
                    reading = full_reading()
                    del reading[code]
                    with self.assertRaisesMessage(ValidationError, label):
                        compute(reading, scenario)

    def test_lines_that_are_not_part_of_the_scenario_are_optional(self):
        s1 = full_reading()
        for code in ("clim_a", "clim_b", "tertiaire"):
            del s1[code]
        self.assertIsNone(compute(s1, "S1")["clim_a"]["kw"])
        s2 = full_reading()
        for code in ("tgbt_a", "tgbt_b"):
            del s2[code]
        self.assertIsNone(compute(s2, "S2")["tgbt_a"]["kw"])

    def test_detail_lines_are_optional(self):
        reading = full_reading()
        del reading["pdf_dc_b4"]
        reading["avr_a"] = {"kwLus": ""}
        computed = compute(reading)
        self.assertIsNone(computed["pdf_dc_b4"]["kw"])
        self.assertIsNone(computed["avr_a"]["kw"])
        self.assertEqual(computed["tgbt_a"]["kw"], 52.0)

    def test_unknown_equipment_and_negative_values_are_rejected(self):
        with self.assertRaises(ValidationError):
            compute(full_reading() | {"serveur_x": {"kwLus": 1}})
        with self.assertRaises(ValidationError):
            compute(full_reading() | {"ups_a": {"kwLus": -3}})

    def test_the_sheet_lists_the_23_equipments_of_the_single_line_diagram(self):
        self.assertEqual(len(PUE_LINES), 23)
        self.assertEqual(len(LINES_BY_CODE), 23)

    def test_avr_lines_are_optional_and_converted_like_the_other_ac_lines(self):
        reading = full_reading() | {"avr_a": {"a": 700}}
        del reading["avr_b"]
        computed = compute(reading)
        self.assertAlmostEqual(computed["avr_a"]["kw"], 436.477, places=3)
        self.assertIsNone(computed["avr_b"]["kw"])


class PueDailyReadingTests(TestCase):
    def values(self, scenario="S1", **overrides):
        return {"site": "Pigeon", "scenario": scenario, "mesures": full_reading(**overrides)}

    def test_pue_is_total_over_it_and_the_date_comes_from_the_server_clock(self):
        values = _calculate_pue_values(self.values(), now=at(11, 30))
        self.assertEqual(values["it_kw"], Decimal("80.000"))
        self.assertEqual(values["total_kw"], Decimal("100.000"))
        self.assertEqual(values["pue"], Decimal("1.250"))
        self.assertEqual(str(values["date_releve"]), "2026-10-12")
        self.assertEqual(str(values["heure_releve"]), "11:30:00")

    def test_s1_deduces_the_non_it_load_from_the_total_and_the_it(self):
        values = _calculate_pue_values(self.values("S1", tgbt_a=62), now=at(11))
        # total 110 kW, IT 80 kW (hors IT déduit : 30 kW)
        self.assertEqual((values["total_kw"], values["it_kw"], values["pue"]),
                         (Decimal("110.000"), Decimal("80.000"), Decimal("1.375")))
        self.assertEqual(values["scenario"], "S1")

    def test_s2_deduces_the_total_from_the_it_and_the_non_it_load(self):
        values = _calculate_pue_values(self.values("S2", clim_a=10, tertiaire=6), now=at(11))
        # hors IT 10 + 8 + 6 = 24 kW ; total déduit 80 + 24 = 104 kW
        self.assertEqual((values["total_kw"], values["it_kw"], values["pue"]),
                         (Decimal("104.000"), Decimal("80.000"), Decimal("1.300")))
        self.assertEqual(values["scenario"], "S2")

    def test_s2_ignores_the_tgbt_and_s1_ignores_cooling_and_tertiary(self):
        self.assertEqual(_calculate_pue_values(self.values("S2", tgbt_a=999), now=at(11))["pue"], Decimal("1.250"))
        self.assertEqual(_calculate_pue_values(self.values("S1", clim_a=999, tertiaire=999), now=at(11))["pue"],
                         Decimal("1.250"))

    def test_the_scenario_is_mandatory_and_must_be_known(self):
        for scenario in (None, "", "S3"):
            with self.subTest(scenario=scenario), self.assertRaisesMessage(ValidationError, "scénario"):
                _calculate_pue_values({"site": "Pigeon", "scenario": scenario, "mesures": full_reading()}, now=at(11))

    def test_avr_and_pdf_lines_do_not_change_the_pue_in_either_scenario(self):
        for scenario in ("S1", "S2"):
            with self.subTest(scenario=scenario):
                base = _calculate_pue_values(self.values(scenario), now=at(11))
                changed = _calculate_pue_values(self.values(scenario, avr_a=120, avr_b=105, pdf_dc_a1=40), now=at(11))
                self.assertEqual((base["pue"], base["it_kw"], base["total_kw"]),
                                 (changed["pue"], changed["it_kw"], changed["total_kw"]))

    def test_a_reading_with_only_the_measured_lines_is_accepted(self):
        for scenario in ("S1", "S2"):
            with self.subTest(scenario=scenario):
                codes = ("ups_a", "ups_b", "redresseurs_a", "redresseurs_b") + (
                    ("tgbt_a", "tgbt_b") if scenario == "S1" else ("clim_a", "clim_b", "tertiaire"))
                mesures = {code: full_reading()[code] for code in codes}
                values = _calculate_pue_values({"site": "Pigeon", "scenario": scenario, "mesures": mesures}, now=at(11))
                self.assertEqual(values["pue"], Decimal("1.250"))

    def test_a_reading_is_accepted_at_any_hour_of_the_day(self):
        for hour, minute in ((0, 5), (9, 59), (13, 0), (23, 59)):
            with self.subTest(hour=hour, minute=minute):
                self.assertEqual(_calculate_pue_values(self.values(), now=at(hour, minute))["pue"], Decimal("1.250"))

    def test_the_day_is_the_kinshasa_day_not_the_utc_day(self):
        # 00h30 à Kinshasa (UTC+1) = 23h30 UTC la veille
        values = _calculate_pue_values(self.values(), now=at(0, 30))
        self.assertEqual(at(0, 30).day, 11)
        self.assertEqual(str(values["date_releve"]), "2026-10-12")

    def test_several_readings_can_be_recorded_the_same_day(self):
        first = _calculate_pue_values(self.values(), now=at(11))
        business_models.PueRecord.objects.create(created_by=uuid4(), **first)
        second = _calculate_pue_values(self.values(tgbt_a=62), now=at(15, 30))
        business_models.PueRecord.objects.create(created_by=uuid4(), **second)
        rows = business_models.PueRecord.objects.filter(site="Pigeon", date_releve=first["date_releve"])
        self.assertEqual(rows.count(), 2)
        self.assertEqual(str(second["heure_releve"]), "15:30:00")

    def test_only_pigeon_is_supported(self):
        with self.assertRaisesMessage(ValidationError, "uniquement pour le site Pigeon"):
            _calculate_pue_values({"site": "Goma", "scenario": "S1", "mesures": full_reading()}, now=at(11))

    def test_s1_it_cannot_exceed_the_total_of_the_site(self):
        with self.assertRaisesMessage(ValidationError, "ne peut pas dépasser"):
            _calculate_pue_values(self.values("S1", tgbt_a=10, tgbt_b=10), now=at(11))

    def test_the_it_must_be_positive(self):
        zeros = dict(ups_a=0, ups_b=0, redresseurs_a=0, redresseurs_b=0)
        with self.assertRaisesMessage(ValidationError, "IT"):
            _calculate_pue_values(self.values("S2", **zeros), now=at(11))

    def test_correction_keeps_the_original_date(self):
        created = _calculate_pue_values(self.values(), now=at(11))
        record = business_models.PueRecord.objects.create(created_by=uuid4(), **created)
        update = {"site": "Pigeon", "scenario": "S1", "mesures": full_reading(tgbt_a=62), "date_releve": "2030-01-01"}
        values = _calculate_pue_values(update, record)
        self.assertNotIn("date_releve", values)
        self.assertEqual(values["pue"], Decimal("1.375"))

    def test_a_correction_can_switch_the_scenario(self):
        created = _calculate_pue_values(self.values("S1"), now=at(11))
        record = business_models.PueRecord.objects.create(created_by=uuid4(), **created)
        update = {"site": "Pigeon", "scenario": "S2", "mesures": full_reading(clim_a=18)}
        values = _calculate_pue_values(update, record)
        self.assertEqual((values["scenario"], values["total_kw"]), ("S2", Decimal("110.000")))

    def test_history_snapshot_lists_the_retained_kw_of_each_line(self):
        values = _calculate_pue_values(self.values(), now=at(11))
        record = business_models.PueRecord(created_by=uuid4(), **values)
        snapshot = _history_snapshot(record)
        self.assertNotIn("mesures", snapshot)
        self.assertEqual(snapshot["kw_tgbt_a"], 52.0)
        self.assertEqual(snapshot["dateReleve"], "2026-10-12")


class PueCorrectionPermissionTests(TestCase):
    """Le Chef de site de Pigeon corrige son relevé ; la suppression reste aux rôles globaux."""

    def setUp(self):
        values = _calculate_pue_values({"site": "Pigeon", "scenario": "S1", "mesures": full_reading()}, now=at(11))
        self.record = business_models.PueRecord.objects.create(created_by=uuid4(), **values)

    def put(self, role, site, **overrides):
        with patch("profiles.views.profile_from_token") as profile_from_token:
            profile_from_token.return_value = SimpleNamespace(id=uuid4(), role=role, site=site, active=True)
            return self.client.put(
                f"/api/records/pue/{self.record.id}", data=json.dumps({"site": "Pigeon", "scenario": "S1", "mesures": full_reading(**overrides)}),
                content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
            )

    def test_chef_site_of_pigeon_can_correct_its_reading(self):
        response = self.put("chef_site", "Pigeon", tgbt_a=62)
        self.assertEqual(response.status_code, 200, response.content)
        self.record.refresh_from_db()
        self.assertEqual(self.record.pue, Decimal("1.375"))
        self.assertEqual(str(self.record.date_releve), "2026-10-12")

    def test_chef_site_of_another_site_cannot_correct_it(self):
        self.assertEqual(self.put("chef_site", "Goma").status_code, 403)

    def test_global_role_can_still_correct_it(self):
        self.assertEqual(self.put("manager", None, tgbt_a=60).status_code, 200)

    def test_chef_site_cannot_delete_a_reading(self):
        with patch("profiles.views.profile_from_token") as profile_from_token:
            profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Pigeon", active=True)
            response = self.client.delete(f"/api/records/pue/{self.record.id}", HTTP_AUTHORIZATION="Bearer valid-token")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(business_models.PueRecord.objects.filter(id=self.record.id).exists())
