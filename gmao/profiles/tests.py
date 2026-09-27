import json
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from .records import (
    _assert_fuel_manual_fields_are_not_sent, _calculate_fuel_delivery_values, _calculate_fuel_values, _calculate_generator_values, _calculate_pue_values, _recalculate_fuel_records, _recalculate_fuel_records_after_delivery_change,
    _fuel_deliveries_total, _generator_fuel_consumption_total, _generator_hours_total, _next_equipment_code,
    _previous_fuel_final_stock,
)
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


class PermissionPolicyTests(SimpleTestCase):
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

    @patch("profiles.permissions.Site.objects")
    def test_global_roles_can_view_all_sites_but_cannot_create_and_can_modify(self, site_objects):
        site_objects.filter.return_value.order_by.return_value.values_list.return_value = ["Bukavu", "Goma"]
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
        target = SimpleNamespace(id=uuid4(), site='Goma')
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='manager', site=None)

        response = profile_delete.__wrapped__.__wrapped__(self._request(actor), target.id)

        self.assertEqual(response.status_code, 409)
        self.assertIn('affecté', json.loads(response.content)['detail'])

    @patch('profiles.users_admin._profile_has_business_history', return_value=True)
    @patch('profiles.users_admin.UserProfile.objects')
    def test_profile_with_business_history_is_rejected(self, profile_objects, has_history):
        target = SimpleNamespace(id=uuid4(), site=None)
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='manager', site=None)

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
    def test_historical_delivery_can_keep_unknown_stocks_empty(self):
        values = _calculate_fuel_delivery_values({
            "quantite_recue": Decimal("1250.500"),
            "stock_avant": None,
            "stock_apres": None,
        })

        self.assertIsNone(values["stock_apres"])
        self.assertFalse(values["difference_stock"])


class FuelCalculationTests(SimpleTestCase):
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

    def test_rejects_manual_initial_stock_on_an_existing_journal(self):
        with self.assertRaises(ValidationError) as error:
            _assert_fuel_manual_fields_are_not_sent(
                {"site": "Goma", "stock_initial": Decimal("1000")},
                SimpleNamespace(stock_initial=Decimal("1000")),
            )
        self.assertIn("stock initial", str(error.exception))
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

    @patch("profiles.records.FuelRecord.objects")
    @patch("profiles.records._previous_fuel_final_stock", return_value=None)
    @patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0"))
    def test_cannot_define_another_initial_stock_after_a_journal_exists(self, group_consumption, previous_stock, fuel_objects):
        fuel_objects.filter.return_value.exists.return_value = True

        with self.assertRaises(ValidationError) as error:
            _calculate_fuel_values(
                {"site": "Goma", "periode": "2025-12", "sortie": Decimal("0"), "stock_initial": Decimal("1000")},
                allow_initial_stock=True,
            )

        self.assertIn("mois antérieur", str(error.exception))

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
        delivery_objects.filter.assert_called_once_with(
            site="Goma",
            date_ravitaillement__gte=date(2026, 2, 1),
            date_ravitaillement__lt=date(2026, 3, 1),
        )

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
