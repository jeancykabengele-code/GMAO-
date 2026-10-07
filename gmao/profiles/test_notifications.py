"""Règles et API des notifications."""

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import SimpleTestCase, TestCase

from .notifications import generator_alert_stage, notify_generator_alert, notify_record_created


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
