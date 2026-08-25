from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from .records import _calculate_fuel_values, _calculate_generator_values, _calculate_pue_values, _next_equipment_code
from .views import current_user

from .permissions import (
    PermissionDeniedError,
    assert_can_create,
    assert_can_delete,
    assert_can_delete_equipment,
    assert_can_modify,
    assert_global_page_access,
    assert_site_access,
    build_permissions,
)


class PermissionPolicyTests(SimpleTestCase):
    def test_chef_site_is_limited_to_own_site_and_cannot_modify(self):
        chef = SimpleNamespace(role="chef_site", site="Goma")

        permissions = build_permissions(chef)

        self.assertEqual(permissions.allowed_sites, ["Goma"])
        self.assertTrue(permissions.create_records)
        self.assertFalse(permissions.modify_existing)
        self.assertFalse(permissions.view_dashboard)
        self.assertFalse(permissions.view_documentation)
        assert_can_create(chef, "Goma")
        assert_site_access(chef, "Goma")
        with self.assertRaises(PermissionDeniedError):
            assert_site_access(chef, "Bukavu")
        with self.assertRaises(PermissionDeniedError):
            assert_can_modify(chef, "Goma")
        with self.assertRaises(PermissionDeniedError):
            assert_global_page_access(chef)

    @patch("profiles.permissions.Site.objects")
    def test_global_roles_can_view_all_sites_create_and_modify(self, site_objects):
        site_objects.filter.return_value.order_by.return_value.values_list.return_value = ["Bukavu", "Goma"]
        for role in ("manager", "charge_operations"):
            profile = SimpleNamespace(role=role, site=None)

            permissions = build_permissions(profile)

            self.assertEqual(permissions.allowed_sites, ["Bukavu", "Goma"])
            self.assertTrue(permissions.global_scope)
            self.assertTrue(permissions.view_dashboard)
            self.assertTrue(permissions.view_documentation)
            self.assertTrue(permissions.create_records)
            self.assertTrue(permissions.modify_existing)
            self.assertFalse(permissions.delete_records)
            assert_site_access(profile, "Utex")
            assert_can_create(profile, "Utex")
            assert_can_modify(profile, "Utex")
            assert_global_page_access(profile)

    def test_deletion_is_forbidden_for_every_role(self):
        for role in ("manager", "charge_operations", "chef_site"):
            with self.assertRaises(PermissionDeniedError):
                assert_can_delete(SimpleNamespace(role=role, site="Goma"))

    def test_only_global_roles_can_delete_equipment(self):
        for role in ("manager", "charge_operations"):
            assert_can_delete_equipment(SimpleNamespace(role=role, site=None))
        with self.assertRaises(PermissionDeniedError):
            assert_can_delete_equipment(SimpleNamespace(role="chef_site", site="Goma"))


class ApiTests(TestCase):
    def test_supabase_bearer_routes_are_csrf_exempt(self):
        self.assertTrue(current_user.csrf_exempt)

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "UP"})

    def test_me_requires_bearer_token(self):
        response = self.client.get("/api/me")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "missing_bearer_token")

    @patch("profiles.views.build_permissions")
    @patch("profiles.views.load_active_profile")
    @patch("profiles.views.verify_supabase_token")
    def test_me_returns_profile_and_server_permissions(self, verify_token, load_profile, permissions):
        user_id = uuid4()
        created_at = datetime(2026, 8, 19, tzinfo=timezone.utc)
        verify_token.return_value = {"sub": str(user_id)}
        load_profile.return_value = SimpleNamespace(
            id=user_id,
            email="manager@example.com",
            full_name="Manager GMAO",
            role="manager",
            site=None,
            active=True,
            created_at=created_at,
        )
        permissions.return_value.as_dict.return_value = {
            "globalScope": True,
            "viewDashboard": True,
            "viewDocumentation": True,
            "createRecords": True,
            "modifyExisting": True,
            "deleteRecords": False,
            "allowedSites": ["Goma", "Utex"],
        }

        response = self.client.get("/api/me", HTTP_AUTHORIZATION="Bearer valid-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fullName"], "Manager GMAO")
        self.assertTrue(response.json()["permissions"]["modifyExisting"])
        self.assertFalse(response.json()["permissions"]["deleteRecords"])

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

class FuelCalculationTests(SimpleTestCase):
    def test_calculates_litres_per_hour_and_grid_availability(self):
        values = _calculate_fuel_values({
            "site": "Goma",
            "periode": "2026-01",
            "sortie": Decimal("300"),
            "heures_ge": Decimal("24"),
            "snel_kwh": Decimal("4500"),
        })

        self.assertEqual(values["litres_heure"], Decimal("12.500"))
        self.assertEqual(values["disponibilite_grid"], Decimal("96.77"))

    def test_no_grid_sites_have_zero_availability_and_no_snel(self):
        values = _calculate_fuel_values({
            "site": "Kikwit",
            "periode": "2026-01",
            "sortie": Decimal("100"),
            "heures_ge": Decimal("10"),
            "snel_kwh": Decimal("999"),
        })

        self.assertEqual(values["disponibilite_grid"], Decimal("0"))
        self.assertIsNone(values["snel_kwh"])

    def test_positive_consumption_with_zero_hours_is_not_calculable(self):
        values = _calculate_fuel_values({
            "site": "Pigeon",
            "periode": "2026-05",
            "sortie": Decimal("2533"),
            "heures_ge": Decimal("0"),
            "snel_kwh": Decimal("320544"),
        })

        self.assertIsNone(values["litres_heure"])

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
