"""Relevés RH : suppression, correction et historique."""

import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase
from login_guard.models import AuditLog

from . import models as business_models


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
    def test_lowering_a_reading_needs_the_manager_approval(self, profile_from_token):
        reading = self._reading()
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="chef_site", site="Goma", active=True)
        refused = self._put(reading, 90)
        self.assertEqual(refused.status_code, 400)
        self.assertIn("approuvée par le Manager GMAO", refused.json()["detail"])
        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="charge_operations", site=None, active=True)
        self.assertEqual(self._put(reading, 90).status_code, 400)
        reading.refresh_from_db()
        self.assertEqual(reading.rh_actuel, Decimal("100.00"))

        profile_from_token.return_value = SimpleNamespace(id=uuid4(), role="manager", site=None, active=True)
        approved = self._put(reading, 90)
        self.assertEqual(approved.status_code, 200, approved.content)
        reading.refresh_from_db()
        self.assertEqual(reading.rh_actuel, Decimal("90.00"))

    @patch("profiles.views.profile_from_token")
    def test_new_month_lower_than_the_previous_reading_needs_the_manager_approval(self, profile_from_token):
        self._reading()

        def post(role):
            profile_from_token.return_value = SimpleNamespace(id=uuid4(), role=role, site="Goma" if role == "chef_site" else None, active=True)
            return self.client.post(
                "/api/records/releves-rh-ge",
                data=json.dumps({"site": "Goma", "periode": "2026-02", "groupeCode": "GE-01", "rhActuel": 80}),
                content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
            )

        refused = post("chef_site")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("approuvée par le Manager GMAO", refused.json()["detail"])
        self.assertFalse(business_models.GeneratorMonthlyReading.objects.filter(periode="2026-02").exists())

    @patch("profiles.views.profile_from_token")
    def test_generator_sheet_rh_cannot_be_lowered_without_the_manager(self, profile_from_token):
        reading = self._reading()
        business_models.Equipment.objects.create(
            site="Goma", code="GE-01", nom="Groupe électrogène", famille="Energie", localisation="Salle GE",
            marque_modele="Groupe", etat="Actif", criticite="Haute", created_by=uuid4(),
        )
        generator = business_models.GeneratorRecord.objects.get(site="Goma", code="GE-01")
        generator.rh_actuel = reading.rh_actuel
        generator.save()

        def put(role):
            profile_from_token.return_value = SimpleNamespace(id=uuid4(), role=role, site=None, active=True)
            return self.client.put(
                f"/api/records/groupes-electrogenes/{generator.id}",
                data=json.dumps({"site": "Goma", "code": "GE-01", "moisReleve": "2026-01", "rhActuel": 50, "rhDernierePm": 0}),
                content_type="application/json", HTTP_AUTHORIZATION="Bearer valid-token",
            )

        refused = put("charge_operations")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("approuvée par le Manager GMAO", refused.json()["detail"])
        generator.refresh_from_db()
        self.assertEqual(generator.rh_actuel, Decimal("100.00"))

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
