import json
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from login_guard.models import AuditLog
from .records import (
    _assert_fuel_manual_fields_are_not_sent, _calculate_fuel_delivery_values, _calculate_fuel_values, _calculate_generator_values, _calculate_pue_values, _recalculate_fuel_records, _recalculate_fuel_records_after_delivery_change,
    _clean_values, _fuel_deliveries_total, _generator_fuel_consumption_total, _generator_hours_total, _next_equipment_code,
    _previous_fuel_final_stock,
)
from . import models as business_models
from .models import UserProfile
from .notifications import generator_alert_stage, notify_generator_alert, notify_record_created
from .views import current_user
from .users_admin import profile_delete
from .services import ProfileAccessError, load_active_profile

from .permissions import (
    PermissionDeniedError,
    assert_can_create,
    assert_can_delete,
    assert_can_delete_equipment,
    assert_can_delete_fuel_record,
    assert_can_modify,
    assert_global_page_access,
    assert_manage_users,
    assert_site_access,
    build_permissions,
)


class BusinessSchemaContractTests(SimpleTestCase):
    MODELS = (
        business_models.UserProfile,
        business_models.LocalCredential,
        business_models.Site,
        business_models.Equipment,
        business_models.Ticket,
        business_models.GeneratorRecord,
        business_models.GeneratorMonthlyReading,
        business_models.FuelRecord,
        business_models.FuelDelivery,
        business_models.GeneratorFuelConsumption,
        business_models.FuelMonthlySummary,
        business_models.PueRecord,
        business_models.DatacenterProblem,
        business_models.Intervention,
        business_models.SparePartOperation,
        business_models.Notification,
    )

    def test_all_business_models_are_managed_by_django(self):
        self.assertEqual(len(self.MODELS), 16)
        self.assertTrue(all(model._meta.managed for model in self.MODELS))

    def test_business_keys_have_versioned_unique_constraints(self):
        expected = {
            business_models.Equipment: (("site", "code"),),
            business_models.Ticket: (("site", "numero"),),
            business_models.GeneratorMonthlyReading: (("site", "periode", "groupe_code"),),
            business_models.FuelRecord: (("site", "periode"),),
            business_models.GeneratorFuelConsumption: (("site", "periode", "groupe_code"),),
            business_models.PueRecord: (("site", "mois"),),
            business_models.Notification: (("recipient_id", "dedupe_key"),),
        }
        for model, unique_together in expected.items():
            with self.subTest(model=model.__name__):
                self.assertEqual(model._meta.unique_together, unique_together)


class PermissionPolicyTests(TestCase):
    def test_chef_site_is_limited_to_own_site_and_cannot_modify(self):
        chef = SimpleNamespace(role="chef_site", site="Goma")

        permissions = build_permissions(chef)

        self.assertEqual(permissions.allowed_sites, ["Goma"])
        self.assertTrue(permissions.create_records)
        self.assertFalse(permissions.modify_existing)
        self.assertFalse(permissions.view_dashboard)
        self.assertFalse(permissions.view_documentation)
        self.assertFalse(permissions.manage_users)
        self.assertFalse(permissions.view_audit_log)
        assert_can_create(chef, "Goma")
        assert_site_access(chef, "Goma")
        with self.assertRaises(PermissionDeniedError):
            assert_site_access(chef, "Bukavu")
        with self.assertRaises(PermissionDeniedError):
            assert_can_modify(chef, "Goma")
        with self.assertRaises(PermissionDeniedError):
            assert_global_page_access(chef)

    @patch("profiles.permissions.UserProfile.objects")
    @patch("profiles.permissions.Site.objects")
    def test_global_roles_can_view_all_sites_but_cannot_create_and_can_modify(self, site_objects, profile_objects):
        site_objects.filter.return_value.order_by.return_value.values_list.return_value = ["Bukavu", "Goma"]
        profile_objects.filter.return_value.exists.return_value = False
        for role in ("manager", "charge_operations"):
            profile = SimpleNamespace(role=role, site=None)

            permissions = build_permissions(profile)

            self.assertEqual(permissions.allowed_sites, ["Bukavu", "Goma"])
            self.assertTrue(permissions.global_scope)
            self.assertTrue(permissions.view_dashboard)
            self.assertTrue(permissions.view_documentation)
            self.assertFalse(permissions.create_records)
            self.assertTrue(permissions.modify_existing)
            self.assertTrue(permissions.delete_records)
            self.assertEqual(permissions.manage_users, role == "manager")
            self.assertEqual(permissions.view_audit_log, role == "manager")
            assert_site_access(profile, "Utex")
            with self.assertRaises(PermissionDeniedError):
                assert_can_create(profile, "Utex")
            assert_can_modify(profile, "Utex")
            assert_global_page_access(profile)
            if role == "manager":
                assert_manage_users(profile)
            else:
                with self.assertRaises(PermissionDeniedError):
                    assert_manage_users(profile)

    @patch("profiles.permissions.UserProfile.objects")
    def test_administrator_has_only_administration_permissions(self, profile_objects):
        administrator = SimpleNamespace(role="administrator", site=None)

        permissions = build_permissions(administrator)

        self.assertFalse(permissions.global_scope)
        self.assertFalse(permissions.view_dashboard)
        self.assertFalse(permissions.view_documentation)
        self.assertFalse(permissions.create_records)
        self.assertFalse(permissions.modify_existing)
        self.assertFalse(permissions.delete_records)
        self.assertTrue(permissions.manage_users)
        self.assertTrue(permissions.view_audit_log)
        self.assertEqual(permissions.allowed_sites, [])
        assert_manage_users(administrator)
        profile_objects.filter.assert_not_called()

    @patch("profiles.permissions.Site.objects")
    @patch("profiles.permissions.UserProfile.objects")
    def test_manager_loses_administration_when_an_active_administrator_exists(self, profile_objects, site_objects):
        profile_objects.filter.return_value.exists.return_value = True
        site_objects.filter.return_value.order_by.return_value.values_list.return_value = ["Goma"]
        manager = SimpleNamespace(role="manager", site=None)

        permissions = build_permissions(manager)

        self.assertFalse(permissions.manage_users)
        self.assertFalse(permissions.view_audit_log)
        with self.assertRaises(PermissionDeniedError):
            assert_manage_users(manager)

    def test_only_global_roles_can_delete_business_records(self):
        for role in ("manager", "charge_operations"):
            assert_can_delete(SimpleNamespace(role=role, site=None))
        with self.assertRaises(PermissionDeniedError):
            assert_can_delete(SimpleNamespace(role="chef_site", site="Goma"))

    def test_only_global_roles_can_delete_equipment(self):
        for role in ("manager", "charge_operations"):
            assert_can_delete_equipment(SimpleNamespace(role=role, site=None))
        with self.assertRaises(PermissionDeniedError):
            assert_can_delete_equipment(SimpleNamespace(role="chef_site", site="Goma"))
    def test_only_global_roles_can_delete_fuel_ge(self):
        for role in ("manager", "charge_operations"):
            assert_can_delete_fuel_record(SimpleNamespace(role=role, site=None))
        with self.assertRaises(PermissionDeniedError):
            assert_can_delete_fuel_record(SimpleNamespace(role="chef_site", site="Goma"))

class ProfileDeletionSafetyTests(SimpleTestCase):
    def setUp(self):
        from django.test import RequestFactory
        self.factory = RequestFactory()

    def _request(self, actor):
        request = self.factory.delete('/api/profiles/target/delete')
        request.gmao_profile = actor
        return request

    @patch('profiles.users_admin.UserProfile.objects')
    def test_chef_site_with_active_assignment_is_rejected(self, profile_objects):
        target = SimpleNamespace(id=uuid4(), role='chef_site', active=True, site='Goma')
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='administrator', site=None)

        response = profile_delete.__wrapped__.__wrapped__(self._request(actor), target.id)

        self.assertEqual(response.status_code, 409)
        self.assertIn('affecté', json.loads(response.content)['detail'])

    @patch('profiles.users_admin._profile_has_business_history', return_value=True)
    @patch('profiles.users_admin.UserProfile.objects')
    def test_profile_with_business_history_is_rejected(self, profile_objects, has_history):
        target = SimpleNamespace(id=uuid4(), role='manager', active=True, site=None)
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='administrator', site=None)

        response = profile_delete.__wrapped__.__wrapped__(self._request(actor), target.id)

        self.assertEqual(response.status_code, 409)
        self.assertIn('historique', json.loads(response.content)['detail'])
        has_history.assert_called_once_with(target.id)
class ApiTests(TestCase):
    def test_authenticated_routes_are_csrf_exempt(self):
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
    @patch("profiles.views.profile_from_token")
    def test_me_returns_profile_and_server_permissions(self, profile_from_token, permissions):
        user_id = uuid4()
        created_at = datetime(2026, 8, 19, tzinfo=timezone.utc)
        profile_from_token.return_value = SimpleNamespace(
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
            "manageUsers": True,
            "viewAuditLog": True,
            "allowedSites": ["Goma", "Utex"],
        }

        response = self.client.get("/api/me", HTTP_AUTHORIZATION="Bearer valid-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fullName"], "Manager GMAO")
        self.assertTrue(response.json()["permissions"]["modifyExisting"])
        self.assertFalse(response.json()["permissions"]["deleteRecords"])

class ProfileActivationTests(SimpleTestCase):
    @patch("profiles.services.UserProfile.objects")
    def test_inactive_profile_is_not_loaded_for_login(self, profile_objects):
        profile_objects.get.side_effect = UserProfile.DoesNotExist
        with self.assertRaises(ProfileAccessError):
            load_active_profile(str(uuid4()))
        profile_objects.get.assert_called_once()
        self.assertEqual(profile_objects.get.call_args.kwargs["active"], True)
    @patch("profiles.services.Site.objects")
    @patch("profiles.services.UserProfile.objects")
    def test_chef_site_on_inactive_site_is_refused_at_login(self, profile_objects, site_objects):
        profile_objects.get.return_value = SimpleNamespace(role="chef_site", site="Goma")
        site_objects.filter.return_value.exists.return_value = False

        with self.assertRaises(ProfileAccessError) as error:
            load_active_profile(str(uuid4()))

        self.assertIn("désactivé", str(error.exception))
        site_objects.filter.assert_called_once_with(name="Goma", active=True)


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
    @patch("profiles.records.GeneratorFuelConsumption.objects")
    def test_monthly_total_comes_from_all_groups_of_the_site(self, consumption_objects):
        consumption_objects.filter.return_value.aggregate.return_value = {"total": Decimal("150")}

        total = _generator_fuel_consumption_total("Goma", "2026-02")

        self.assertEqual(total, Decimal("150"))
        consumption_objects.filter.assert_called_once_with(site="Goma", periode="2026-02")

    def test_one_group_is_unique_per_site_and_month(self):
        from .models import GeneratorFuelConsumption
        self.assertIn(("site", "periode", "groupe_code"), GeneratorFuelConsumption._meta.unique_together)


class HistoricalFuelDeliveryTests(SimpleTestCase):
    @patch("profiles.records._assign_delivery_period_and_rank")
    def test_historical_delivery_can_keep_unknown_stocks_empty(self, assign_period):
        values = _calculate_fuel_delivery_values({
            "quantite_recue": Decimal("1250.500"),
            "stock_avant": None,
            "stock_apres": None,
        })

        self.assertIsNone(values["stock_apres"])
        self.assertFalse(values["difference_stock"])


class FuelCalculationTests(TestCase):
    @patch("profiles.records._generator_hours_total", return_value=Decimal("24"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("100"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("300"))
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

    @patch("profiles.records._generator_hours_total", return_value=Decimal("10"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("100"))
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

    @patch("profiles.records._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("253"))
    def test_positive_consumption_with_zero_hours_is_not_calculable(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values({
            "site": "Pigeon",
            "periode": "2026-05",
            "sortie": Decimal("253"),
            "snel_kwh": Decimal("320544"),
        })

        self.assertIsNone(values["litres_heure"])

    @patch("profiles.records._generator_hours_total", return_value=Decimal("50"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("300"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("1000"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("200"))
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
    @patch("profiles.records._generator_hours_total", return_value=None)
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("10"))
    def test_rejects_save_when_generator_hours_cannot_be_calculated(self, group_consumption, previous_stock, deliveries, generator_hours):
        with self.assertRaises(ValidationError):
            _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "sortie": Decimal("10")})

    @patch("profiles.records._generator_hours_total", return_value=Decimal("20"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("100"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("50"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("151"))
    def test_rejects_consumption_that_makes_automatic_final_stock_negative(self, group_consumption, previous_stock, deliveries, generator_hours):
        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "sortie": Decimal("151")})
        self.assertIn("stock final négatif", str(error.exception))

    @patch("profiles.records._generator_hours_total", return_value=Decimal("12.3333333333"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("100.000000000001"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500.100000000000"))
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("300.000000000002"))
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

    @patch("profiles.records.FuelRecord.objects")
    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_chef_site_cannot_define_initial_fuel_stock(self, group_consumption, previous_stock, fuel_objects):
        fuel_objects.filter.return_value.exists.return_value = False

        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values(
                {"site": "Goma", "periode": "2026-01", "sortie": Decimal("0"), "stock_initial": Decimal("1000")},
                allow_initial_stock=False,
            )

        self.assertIn("Seul le Manager", str(error.exception))

    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("150"))
    @patch("profiles.records._generator_hours_total", return_value=Decimal("30"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("200"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    def test_two_groups_scenario_recalculates_the_site_fuel_totals(self, previous_stock, deliveries, generator_hours, group_total):
        values = _calculate_fuel_values({"site": "Goma", "periode": "2026-02", "snel_kwh": Decimal("4200")})

        self.assertEqual(values["sortie"], Decimal("150"))
        self.assertEqual(values["stock_final"], Decimal("550"))
        self.assertEqual(values["litres_heure"], Decimal("5.000"))

    def test_rejects_manual_values_that_are_calculated_automatically(self):
        with self.assertRaises(ValidationError) as error:
            _assert_fuel_manual_fields_are_not_sent({"site": "Goma", "sortie": Decimal("100")})
        self.assertIn("calculées automatiquement", str(error.exception))

    @patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("500"))
    def test_rejects_manual_initial_stock_on_an_existing_journal(self, previous_stock):
        with self.assertRaises(ValidationError) as error:
            _assert_fuel_manual_fields_are_not_sent(
                {"site": "Goma", "stock_initial": Decimal("1000")},
                SimpleNamespace(site="Goma", periode="2026-02", stock_initial=Decimal("1000")),
            )
        self.assertIn("stock initial", str(error.exception))

    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    def test_allows_manual_initial_stock_on_the_oldest_journal(self, previous_stock):
        _assert_fuel_manual_fields_are_not_sent(
            {"site": "Goma", "stock_initial": Decimal("1000")},
            SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900")),
        )

    @patch("profiles.records._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_oldest_journal_initial_stock_can_be_corrected(self, group_consumption, previous_stock, deliveries, generator_hours):
        record = SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900"))
        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2026-01", "stock_initial": Decimal("1000")}, record, allow_initial_stock=True,
        )
        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("1000"))

    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_oldest_journal_initial_stock_correction_needs_permission(self, group_consumption, previous_stock):
        record = SimpleNamespace(site="Goma", periode="2026-01", stock_initial=Decimal("900"))
        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values(
                {"site": "Goma", "periode": "2026-01", "stock_initial": Decimal("1000")}, record, allow_initial_stock=False,
            )
        self.assertIn("Seul le Manager", str(error.exception))
    @patch("profiles.records._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records.FuelRecord.objects")
    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("100"))
    def test_global_role_can_define_initial_fuel_stock_once(self, group_consumption, previous_stock, fuel_objects, deliveries, generator_hours):
        fuel_objects.filter.return_value.exists.return_value = False

        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2026-01", "sortie": Decimal("100"), "stock_initial": Decimal("1000")},
            allow_initial_stock=True,
        )

        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("900"))

    @patch("profiles.records._generator_hours_total", return_value=Decimal("0"))
    @patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0"))
    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_can_define_an_initial_stock_on_an_earlier_month(self, group_consumption, previous_stock, deliveries, generator_hours):
        values = _calculate_fuel_values(
            {"site": "Goma", "periode": "2025-12", "sortie": Decimal("0"), "stock_initial": Decimal("1000")},
            allow_initial_stock=True,
        )
        self.assertEqual(values["stock_initial"], Decimal("1000"))
        self.assertEqual(values["stock_final"], Decimal("1000"))

class FuelRecalculationTests(SimpleTestCase):
    @patch("profiles.records._calculate_fuel_values")
    @patch("profiles.records.FuelRecord.objects")
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

class FuelDeliveryRecalculationTests(SimpleTestCase):
    @patch("profiles.records._recalculate_fuel_records", side_effect=ValidationError("Les relevés RH du mois et du mois précédent sont nécessaires pour calculer les heures GE."))
    def test_delivery_change_is_kept_when_generator_readings_are_missing(self, recalculate):
        _recalculate_fuel_records_after_delivery_change("Goma", "2026-02", uuid4())
        recalculate.assert_called_once()

class FuelAutomaticInputsTests(SimpleTestCase):
    @patch("profiles.records.FuelDelivery.objects")
    def test_sums_deliveries_for_the_site_and_month(self, delivery_objects):
        delivery_objects.filter.return_value.aggregate.return_value = {"total": Decimal("1250.500")}

        total = _fuel_deliveries_total("Goma", "2026-02")

        self.assertEqual(total, Decimal("1250.500"))
        delivery_objects.filter.assert_called_once_with(site="Goma", periode="2026-02")

    @patch("profiles.records.FuelDelivery.objects")
    def test_returns_zero_when_no_delivery_exists(self, delivery_objects):
        delivery_objects.filter.return_value.aggregate.return_value = {"total": None}
        self.assertEqual(_fuel_deliveries_total("Goma", "2026-02"), Decimal("0"))

    @patch("profiles.records.FuelRecord.objects")
    def test_reads_the_previous_month_final_stock(self, fuel_objects):
        fuel_objects.filter.return_value.order_by.return_value.values_list.return_value.first.return_value = Decimal("2650")

        stock = _previous_fuel_final_stock("Goma", "2026-02")

        self.assertEqual(stock, Decimal("2650"))
        fuel_objects.filter.assert_called_once_with(site="Goma", periode__lt="2026-02")

    @patch("profiles.records.GeneratorRecord.objects")
    def test_sums_monthly_hours_from_each_generator_counter(self, generator_objects):
        current = MagicMock()
        current.values.return_value = [
            {"code": "DC-GOM-GE-001", "rh_actuel": Decimal("220")},
            {"code": "DC-GOM-GE-002", "rh_actuel": Decimal("130")},
        ]
        previous_one = MagicMock()
        previous_one.order_by.return_value.values_list.return_value.first.return_value = Decimal("200")
        previous_two = MagicMock()
        previous_two.order_by.return_value.values_list.return_value.first.return_value = Decimal("100")
        generator_objects.filter.side_effect = [current, previous_one, previous_two]

        hours = _generator_hours_total("Goma", "2026-02")

        self.assertEqual(hours, Decimal("50"))

    @patch("profiles.records.GeneratorMonthlyReading.objects")
    @patch("profiles.records.GeneratorRecord.objects")
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

    @patch("profiles.records.GeneratorMonthlyReading.objects")
    @patch("profiles.records.GeneratorRecord.objects")
    def test_returns_none_when_a_previous_generator_reading_is_missing(self, generator_objects, reading_objects):
        generator_objects.filter.return_value.values_list.return_value = ["DC-GOM-GE-001"]
        current = MagicMock()
        current.values.return_value = [{"groupe_code": "DC-GOM-GE-001", "rh_actuel": Decimal("220")}]
        previous = MagicMock()
        previous.order_by.return_value.values_list.return_value.first.return_value = None
        reading_objects.filter.side_effect = [current, previous]
        self.assertIsNone(_generator_hours_total("Goma", "2026-02"))
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


class NotificationRulesTests(SimpleTestCase):
    def generator(self, hours, state="Normal", delayed=False):
        return SimpleNamespace(
            id=uuid4(),
            site="Goma",
            code="DC-GOM-GE-001",
            rh_depuis_derniere_pm=Decimal(str(hours)),
            rh_derniere_pm=Decimal("1000"),
            etat=state,
            retard_signale=delayed,
        )

    def test_generator_alert_stages_include_prealert_and_existing_thresholds(self):
        self.assertIsNone(generator_alert_stage(self.generator("149.99")))
        self.assertEqual(generator_alert_stage(self.generator("150"))[0], "approaching")
        self.assertEqual(generator_alert_stage(self.generator("175", "ASurveiller"))[0], "watch")
        self.assertEqual(generator_alert_stage(self.generator("225", "PmUrgente"))[0], "urgent")
        self.assertEqual(generator_alert_stage(self.generator("250", "PmDepassee"))[0], "overdue")
        self.assertEqual(generator_alert_stage(self.generator("10", delayed=True))[0], "watch")

    @patch("profiles.notifications._save_notifications")
    @patch("profiles.notifications._global_recipients")
    def test_chef_site_creation_notifies_every_global_recipient(self, recipients, save_notifications):
        recipients.return_value = [SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]
        actor = SimpleNamespace(id=uuid4(), role="chef_site", full_name="Chef Goma")
        record = SimpleNamespace(id=uuid4(), site="Goma")

        notify_record_created(actor, "fuel-ge", record)

        notifications = save_notifications.call_args.args[0]
        self.assertEqual(len(notifications), 2)
        self.assertTrue(all(item.severity == "info" for item in notifications))
        self.assertTrue(all(item.resource == "fuel-ge" for item in notifications))
        self.assertIn("Chef Goma", notifications[0].message)

    @patch("profiles.notifications._save_notifications")
    @patch("profiles.notifications._global_recipients")
    def test_generator_alert_has_stable_dedupe_key_per_pm_cycle(self, recipients, save_notifications):
        recipients.return_value = [SimpleNamespace(id=uuid4())]
        actor = SimpleNamespace(id=uuid4(), role="chef_site", full_name="Chef Goma")
        record = self.generator("225", "PmUrgente")

        notify_generator_alert(actor, record)

        notification = save_notifications.call_args.args[0][0]
        self.assertEqual(notification.severity, "critical")
        self.assertIn("urgent", notification.dedupe_key)
        self.assertIn(str(record.id), notification.dedupe_key)


class NotificationApiTests(TestCase):
    @patch("profiles.notifications.Notification.objects")
    @patch("profiles.views.profile_from_token")
    def test_global_user_can_list_personal_notifications(self, profile_from_token, notification_objects):
        user_id = uuid4()
        profile_from_token.return_value = SimpleNamespace(
            id=user_id,
            role="manager",
            site=None,
            active=True,
        )
        notification = SimpleNamespace(
            id=uuid4(),
            site="Goma",
            event_type="record_created",
            resource="fuel-ge",
            resource_id=uuid4(),
            title="Nouvel ajout — Fuel-GE",
            message="Chef Goma a ajouté une donnée.",
            severity="info",
            read_at=None,
            created_at=datetime(2026, 8, 26, tzinfo=timezone.utc),
        )
        list_query = MagicMock()
        list_query.order_by.return_value.__getitem__.return_value = [notification]
        unread_query = MagicMock()
        unread_query.count.return_value = 1
        notification_objects.filter.side_effect = [list_query, unread_query]

        response = self.client.get(
            "/api/notifications",
            HTTP_AUTHORIZATION="Bearer valid-token",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["unreadCount"], 1)
        self.assertEqual(response.json()["items"][0]["actionPath"], "/fuel-ge")


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


class GeneratorRecordRemovedAfterReadingDeletionTests(TestCase):
    """Régression : la fiche gardait le RH de la dernière PM et les valeurs du dernier relevé supprimé."""

    def _generator(self, site="Kikwit"):
        return business_models.GeneratorRecord.objects.create(
            site=site, code="GE-01", type_ge="GE", mois_releve="2026-01", rh_actuel=130, rh_derniere_pm=100,
            rh_depuis_derniere_pm=30, rh_prochaine_pm=350, etat="Normal", commentaires="ancien commentaire",
            created_by=uuid4(),
        )

    @patch("profiles.views.profile_from_token")
    def test_deleting_the_last_reading_removes_the_generator_record(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        self._generator()
        reading = business_models.GeneratorMonthlyReading.objects.create(
            site="Kikwit", periode="2026-01", groupe_code="GE-01", rh_actuel=130, created_by=uuid4(),
        )

        response = self.client.delete(f"/api/records/releves-rh-ge/{reading.id}", HTTP_AUTHORIZATION="Bearer valid-token")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(business_models.GeneratorRecord.objects.filter(site="Kikwit", code="GE-01").exists())

    @patch("profiles.views.profile_from_token")
    def test_deleting_one_of_several_readings_keeps_the_generator_record(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        generator = self._generator()
        readings = [
            business_models.GeneratorMonthlyReading.objects.create(
                site="Kikwit", periode=periode, groupe_code="GE-01", rh_actuel=rh, created_by=uuid4(),
            ) for periode, rh in (("2025-12", 100), ("2026-01", 130))
        ]

        response = self.client.delete(f"/api/records/releves-rh-ge/{readings[1].id}", HTTP_AUTHORIZATION="Bearer valid-token")

        self.assertEqual(response.status_code, 200, response.content)
        generator.refresh_from_db()
        self.assertEqual(generator.mois_releve, "2025-12")
        self.assertEqual(generator.rh_derniere_pm, Decimal("100"))

    @patch("profiles.views.profile_from_token")
    def test_recreating_a_group_replaces_a_leftover_record_without_readings(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Kikwit", active=True)
        self._generator()  # reliquat : aucun relevé
        business_models.Equipment.objects.create(
            site="Kikwit", code="GE-01", nom="Groupe électrogène", famille="Energie", localisation="Salle",
            marque_modele="Perkins", etat="En service", criticite="Elevee", created_by=uuid4(),
        )

        response = self.client.post(
            "/api/records/groupes-electrogenes",
            data=json.dumps({
                "site": "Kikwit", "code": "GE-01", "typeGe": "GE", "moisReleve": "2026-10", "rhActuel": 50,
                "rhDernierePm": 40, "retardSignale": False, "commentaires": "",
            }),
            content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
        )

        self.assertEqual(response.status_code, 201, response.content)
        record = business_models.GeneratorRecord.objects.get(site="Kikwit", code="GE-01")
        self.assertEqual(record.rh_derniere_pm, Decimal("40"))
        self.assertEqual(record.commentaires, "")


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
        from .records import _assign_delivery_period_and_rank
        for rank in range(1, 6):
            values = {"site": "Goma", "periode": "2026-01"}
            _assign_delivery_period_and_rank(values)
            self.assertEqual(values["rang"], rank)
            self._create(rang=rank)
        with self.assertRaises(ValidationError):
            _assign_delivery_period_and_rank({"site": "Goma", "periode": "2026-01"})

    def test_rank_must_be_between_one_and_five_and_unique_for_the_month(self):
        from .records import _assign_delivery_period_and_rank
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
        from .records import _assign_delivery_period_and_rank
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


class ReadingCorrectionPermissionTests(TestCase):
    """Le Chef de site corrige les relevés RH de son site ; les autres sites et la suppression restent protégés."""

    def _reading(self, site="Goma"):
        business_models.GeneratorRecord.objects.get_or_create(
            site=site, code="GE-01", defaults=dict(type_ge="GE", mois_releve="2026-01", rh_actuel=0, rh_derniere_pm=0,
                rh_depuis_derniere_pm=0, rh_prochaine_pm=250, etat="Normal", created_by=uuid4()),
        )
        return business_models.GeneratorMonthlyReading.objects.create(
            site=site, periode="2026-01", groupe_code="GE-01", rh_actuel=Decimal("100"), created_by=uuid4(),
        )

    def _put(self, reading, rh):
        return self.client.put(
            f"/api/records/releves-rh-ge/{reading.id}",
            data=json.dumps({"site": reading.site, "periode": "2026-01", "groupeCode": "GE-01", "rhActuel": rh}),
            content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
        )

    @patch("profiles.views.profile_from_token")
    def test_chef_site_can_correct_a_reading_of_its_own_site(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        reading = self._reading()
        response = self._put(reading, 120.5)
        self.assertEqual(response.status_code, 200, response.content)
        reading.refresh_from_db()
        self.assertEqual(reading.rh_actuel, Decimal("120.50"))

    @patch("profiles.views.profile_from_token")
    def test_chef_site_cannot_correct_a_reading_of_another_site(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        reading = self._reading("Utex")
        self.assertEqual(self._put(reading, 120).status_code, 403)
        reading.refresh_from_db()
        self.assertEqual(reading.rh_actuel, Decimal("100.00"))

    @patch("profiles.views.profile_from_token")
    def test_chef_site_still_cannot_delete_a_reading(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        reading = self._reading()
        response = self.client.delete(f"/api/records/releves-rh-ge/{reading.id}", HTTP_AUTHORIZATION="Bearer valid-token")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(business_models.GeneratorMonthlyReading.objects.filter(id=reading.id).exists())

    @patch("profiles.views.profile_from_token")
    def test_reading_correction_keeps_the_previous_value_in_the_history(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        reading = self._reading()
        self.assertEqual(self._put(reading, 120.5).status_code, 200)
        entry = AuditLog.objects.get(action="record_update", target_id=str(reading.id))
        self.assertEqual(entry.target_type, "releves-rh-ge")
        self.assertEqual(entry.details["old"]["rhActuel"], 100.0)
        self.assertEqual(entry.details["new"]["rhActuel"], 120.5)
        self.assertEqual(entry.details["new"]["groupeCode"], "GE-01")
        self.assertNotIn("updatedAt", entry.details["new"])

    @patch("profiles.views.profile_from_token")
    def test_unchanged_save_and_other_resources_are_handled_by_the_history(self, profile_from_token):
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        reading = self._reading()
        self.assertEqual(self._put(reading, 100).status_code, 200)
        self.assertFalse(AuditLog.objects.filter(action="record_update").exists())
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        created = self.client.post(
            "/api/records/equipements",
            data=json.dumps({"site": "Goma", "nom": "Onduleur A", "famille": "Energie", "localisation": "Salle 1", "marqueModele": "X1", "etat": "Actif", "criticite": "Haute"}),
            content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
        )
        self.assertEqual(created.status_code, 201, created.content)
        entry = AuditLog.objects.get(action="record_create", target_type="equipements")
        self.assertEqual(entry.details["new"]["nom"], "Onduleur A")
        self.assertEqual(entry.details["site"], "Goma")
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        deleted = self.client.delete(f"/api/records/equipements/{created.json()['id']}", HTTP_AUTHORIZATION="Bearer valid-token")
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertEqual(AuditLog.objects.get(action="record_delete", target_type="equipements").details["old"]["nom"], "Onduleur A")
