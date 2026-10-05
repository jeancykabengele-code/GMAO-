import importlib
import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.db import IntegrityError
from django.test import TestCase, override_settings
from django.utils import timezone

from login_guard.models import AuditLog

from .local_auth import issue_token, set_local_password
from .models import Equipment, FuelDelivery, FuelRecord, GeneratorMonthlyReading, Notification, Site, UserProfile
from .records import _calculate_fuel_values

mark_off_grid_sites = importlib.import_module(
    "profiles.migrations.0005_site_grid_and_unique_accounts"
).mark_off_grid_sites


PASSWORD = "Phrase-longue-2026!"


@override_settings(GMAO_PWNED_PASSWORD_CHECK=False)
class GridConnectedAndSiteRenameTests(TestCase):
    def setUp(self):
        self.administrator = UserProfile.objects.create(
            id=uuid4(), email="admin@example.com", full_name="Administrateur GMAO",
            role="administrator", site=None, active=True, created_at=timezone.now(),
        )
        set_local_password(self.administrator.id, PASSWORD)
        self.token = issue_token(self.administrator)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type="application/json", **self.auth)

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type="application/json", **self.auth)

    def test_site_rename_follows_equipment_fuel_notifications_and_the_chef(self):
        created = self.post_json("/api/sites", {"name": "Ancien", "code": "ANC", "gridConnected": True})
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(AuditLog.objects.filter(action="site_create", target_id="Ancien").exists())
        chef = UserProfile.objects.create(
            id=uuid4(), email="chef@example.com", full_name="Chef",
            role="chef_site", site="Ancien", active=True, created_at=timezone.now(),
        )
        Equipment.objects.create(
            site="Ancien", created_by=self.administrator.id, code="EQ-1", nom="Groupe",
            famille="Energie", localisation="Salle", marque_modele="X", etat="Bon", criticite="Haute",
        )
        FuelDelivery.objects.create(
            site="Ancien", created_by=self.administrator.id, periode="2026-01", rang=1, date_ravitaillement=date(2026, 1, 15),
            fournisseur="Total", bon_livraison="BL-1", type_carburant="Diesel",
            quantite_recue=Decimal("10"), receptionne_par="Agent",
        )
        Notification.objects.create(
            recipient_id=self.administrator.id, site="Ancien", event_type="info",
            resource="site", title="Alerte", message="Message",
        )

        renamed = self.patch_json("/api/sites/Ancien", {"name": "Nouveau", "code": "NVO"})
        self.assertEqual(renamed.status_code, 200, renamed.content)
        self.assertEqual(renamed.json()["name"], "Nouveau")
        self.assertFalse(Site.objects.filter(name="Ancien").exists())
        self.assertEqual(Equipment.objects.get().site, "Nouveau")
        self.assertEqual(FuelDelivery.objects.get().site, "Nouveau")
        self.assertEqual(Notification.objects.get().site, "Nouveau")
        self.assertEqual(UserProfile.objects.get(id=chef.id).site, "Nouveau")
        self.assertTrue(AuditLog.objects.filter(action="site_update", target_id="Nouveau").exists())

    def test_duplicate_site_code_returns_409(self):
        self.assertEqual(self.post_json("/api/sites", {"name": "Goma", "code": "GOM"}).status_code, 201)
        duplicate = self.post_json("/api/sites", {"name": "Autre", "code": "gom"})
        self.assertEqual(duplicate.status_code, 409)

    def test_site_with_a_delivery_or_a_reading_cannot_be_deleted(self):
        Site.objects.create(name="Livraison", code="LIV", active=True)
        FuelDelivery.objects.create(
            site="Livraison", created_by=self.administrator.id, periode="2026-02", rang=1,
            fournisseur="Total", bon_livraison="BL-2", type_carburant="Diesel",
            quantite_recue=Decimal("5"), receptionne_par="Agent",
        )
        blocked = self.client.delete("/api/sites/Livraison", **self.auth)
        self.assertEqual(blocked.status_code, 409)
        self.assertTrue(Site.objects.filter(name="Livraison").exists())

        Site.objects.create(name="Releve", code="REL", active=True)
        GeneratorMonthlyReading.objects.create(
            site="Releve", created_by=self.administrator.id, periode="2026-02", groupe_code="GE-1", rh_actuel=Decimal("12"),
        )
        reading_block = self.client.delete("/api/sites/Releve", **self.auth)
        self.assertEqual(reading_block.status_code, 409)

    def test_unchecking_the_grid_zeros_availability_and_clears_snel(self):
        Site.objects.create(name="Kikwit", code="KKW", active=True, grid_connected=True)
        FuelRecord.objects.create(
            site="Kikwit", created_by=self.administrator.id, periode="2026-01",
            stock_initial=Decimal("10"), entree=Decimal("0"), sortie=Decimal("0"),
            stock_final=Decimal("10"), heures_ge=Decimal("0"), snel_kwh=Decimal("100"),
            disponibilite_grid=Decimal("90"),
        )
        updated = self.patch_json("/api/sites/Kikwit", {"gridConnected": False})
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertFalse(updated.json()["gridConnected"])
        record = FuelRecord.objects.get(site="Kikwit")
        self.assertIsNone(record.snel_kwh)
        self.assertEqual(record.disponibilite_grid, Decimal("0"))

        with (
            patch("profiles.records._generator_hours_total", return_value=Decimal("10")),
            patch("profiles.records._fuel_deliveries_total", return_value=Decimal("0")),
            patch("profiles.records._previous_fuel_final_stock", return_value=Decimal("10")),
            patch("profiles.records._generator_fuel_consumption_total", return_value=Decimal("0")),
        ):
            values = _calculate_fuel_values({
                "site": "Kikwit", "periode": "2026-02", "sortie": Decimal("0"), "snel_kwh": Decimal("50"),
            })
        self.assertEqual(values["disponibilite_grid"], Decimal("0"))
        self.assertIsNone(values["snel_kwh"])

        me = self.client.get("/api/me", **self.auth)
        self.assertIn("Kikwit", me.json()["permissions"]["offGridSites"])

    def test_known_off_grid_names_are_marked_by_the_migration(self):
        Site.objects.create(name="Mbandaka", code="MBA", active=True, grid_connected=True)
        mark_off_grid_sites(apps, None)
        self.assertFalse(Site.objects.get(name="Mbandaka").grid_connected)

    def test_duplicate_email_is_rejected_at_the_database_level(self):
        UserProfile.objects.create(
            id=uuid4(), email="duplicate@example.com", full_name="Un",
            role="chef_site", site=None, active=True, created_at=timezone.now(),
        )
        with self.assertRaises(IntegrityError):
            UserProfile.objects.create(
                id=uuid4(), email="duplicate@example.com", full_name="Deux",
                role="chef_site", site=None, active=True, created_at=timezone.now(),
            )
