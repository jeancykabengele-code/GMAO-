"""Contrat du schéma métier."""


from django.test import SimpleTestCase

from . import models as business_models


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
            business_models.PueRecord: (("site", "date_releve"),),
            business_models.Notification: (("recipient_id", "dedupe_key"),),
        }
        for model, unique_together in expected.items():
            with self.subTest(model=model.__name__):
                self.assertEqual(model._meta.unique_together, unique_together)
