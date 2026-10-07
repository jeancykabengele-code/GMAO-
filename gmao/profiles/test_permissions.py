"""Droits d'accès par rôle, suppression et activation des profils."""

import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import SimpleTestCase, TestCase

from .models import UserProfile
from .permissions import PermissionDeniedError, assert_can_create, assert_can_delete, assert_can_delete_equipment, assert_can_delete_fuel_record, assert_can_modify, assert_global_page_access, assert_manage_users, assert_site_access, build_permissions
from .services import ProfileAccessError, load_active_profile
from .users_admin import profile_delete


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
