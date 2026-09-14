import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from .records import _calculate_fuel_values, _calculate_generator_values, _calculate_pue_values, _next_equipment_code
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

class ProfileDeletionSafetyTests(SimpleTestCase):
    def setUp(self):
        from django.test import RequestFactory
        self.factory = RequestFactory()

    def _request(self, actor):
        request = self.factory.delete('/api/profiles/target/delete')
        request.gmao_profile = actor
        return request

    @patch('profiles.users_admin._admin_request')
    @patch('profiles.users_admin.UserProfile.objects')
    def test_chef_site_with_active_assignment_is_rejected(self, profile_objects, admin_request):
        target = SimpleNamespace(id=uuid4(), site='Goma')
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='manager', site=None)

        response = profile_delete.__wrapped__.__wrapped__(self._request(actor), target.id)

        self.assertEqual(response.status_code, 409)
        self.assertIn('affecté', json.loads(response.content)['detail'])
        admin_request.assert_not_called()

    @patch('profiles.users_admin._profile_has_business_history', return_value=True)
    @patch('profiles.users_admin._admin_request')
    @patch('profiles.users_admin.UserProfile.objects')
    def test_profile_with_business_history_is_rejected(self, profile_objects, admin_request, has_history):
        target = SimpleNamespace(id=uuid4(), site=None)
        profile_objects.get.return_value = target
        actor = SimpleNamespace(id=uuid4(), role='charge_operations', site=None)

        response = profile_delete.__wrapped__.__wrapped__(self._request(actor), target.id)

        self.assertEqual(response.status_code, 409)
        self.assertIn('historique', json.loads(response.content)['detail'])
        has_history.assert_called_once_with(target.id)
        admin_request.assert_not_called()
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
    @patch("profiles.views.load_active_profile")
    @patch("profiles.views.verify_supabase_token")
    def test_global_user_can_list_personal_notifications(self, verify_token, load_profile, notification_objects):
        user_id = uuid4()
        verify_token.return_value = {"sub": str(user_id)}
        load_profile.return_value = SimpleNamespace(
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

