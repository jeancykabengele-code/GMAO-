"""Règles des groupes électrogènes : fiche de suivi, relevés RH mensuels et prochaine PM."""

import re
import unicodedata
from decimal import Decimal

from django.core.exceptions import ValidationError

from ..models import Equipment, GeneratorMonthlyReading, GeneratorRecord
from .fuel import _fuel_period_bounds


def _is_generator_equipment(equipment):
    normalized_code = unicodedata.normalize("NFKD", equipment.code or "").encode("ascii", "ignore").decode("ascii").lower()
    description = " ".join((equipment.nom or "", equipment.marque_modele or "")).lower()
    return equipment.famille == "Energie" and (
        "groupe" in description
        or "electrogene" in description
        or re.search(r"(^|[^a-z0-9])ge([^a-z0-9]|$)", normalized_code)
    )


def _set_generator_from_equipment(values, record=None):
    site = values.get("site", getattr(record, "site", None))
    code = values.get("code", getattr(record, "code", None))
    equipment = Equipment.objects.filter(site=site, code=code).first()
    if not equipment or not _is_generator_equipment(equipment):
        raise ValidationError("Le groupe doit être sélectionné parmi les groupes électrogènes enregistrés dans Équipements pour ce site.")
    values["type_ge"] = equipment.nom or equipment.marque_modele
    return values


def _assert_generator_code_unique(values, record=None):
    site = values.get("site", getattr(record, "site", None))
    code = values.get("code", getattr(record, "code", None))
    if not site or not code:
        raise ValidationError("Le site et le code du groupe sont obligatoires.")
    records = GeneratorRecord.objects.filter(site=site, code=code)
    if record is not None:
        records = records.exclude(id=record.id)
    if records.exists():
        raise ValidationError("Un groupe électrogène utilise déjà ce code pour ce site.")


def _discard_orphan_generator_records(values):
    """Supprime les fiches d'un groupe sans aucun relevé RH (reliquats de relevés supprimés) avant d'en recréer une."""
    site, code = values.get("site"), values.get("code")
    if not site or not code:
        return
    has_reading = GeneratorMonthlyReading.objects.filter(site=site, groupe_code=code).exists()
    if not has_reading:
        GeneratorRecord.objects.filter(site=site, code=code).delete()


def _calculate_generator_values(values, record=None):
    rh_actuel = values.get("rh_actuel", getattr(record, "rh_actuel", None))
    rh_derniere_pm = values.get("rh_derniere_pm", getattr(record, "rh_derniere_pm", None))
    retard_signale = values.get("retard_signale", getattr(record, "retard_signale", False))
    if rh_actuel is None or rh_derniere_pm is None:
        raise ValidationError("Les compteurs RH actuel et RH dernière PM sont obligatoires.")
    if rh_actuel < rh_derniere_pm:
        raise ValidationError("Le compteur RH actuel ne peut pas être inférieur au compteur de la dernière PM.")
    rh_depuis_pm = rh_actuel - rh_derniere_pm
    values["rh_depuis_derniere_pm"] = rh_depuis_pm
    values["rh_prochaine_pm"] = rh_derniere_pm + Decimal("250")
    if rh_depuis_pm >= Decimal("250"):
        values["etat"] = "PmDepassee"
    elif rh_depuis_pm >= Decimal("225"):
        values["etat"] = "PmUrgente"
    elif rh_depuis_pm >= Decimal("175") or retard_signale:
        values["etat"] = "ASurveiller"
    else:
        values["etat"] = "Normal"
    return values


def _validate_monthly_reading(values, record=None):
    site = values.get("site", getattr(record, "site", None))
    periode = values.get("periode", getattr(record, "periode", None))
    groupe_code = values.get("groupe_code", getattr(record, "groupe_code", None))
    rh_actuel = values.get("rh_actuel", getattr(record, "rh_actuel", None))
    if not site or not periode or not groupe_code or rh_actuel is None:
        raise ValidationError("Le site, le mois, le groupe et le compteur RH sont obligatoires.")
    _fuel_period_bounds(periode)
    if rh_actuel < 0:
        raise ValidationError("Le compteur RH ne peut pas être négatif.")
    if not GeneratorRecord.objects.filter(site=site, code=groupe_code).exists():
        raise ValidationError("Le groupe électrogène sélectionné n'existe pas pour ce site.")
    readings = GeneratorMonthlyReading.objects.filter(site=site, groupe_code=groupe_code)
    if record is not None:
        readings = readings.exclude(id=record.id)
    if readings.filter(periode=periode).exists():
        raise ValidationError("Un relevé RH existe déjà pour ce groupe et ce mois.")
    previous = readings.filter(periode__lt=periode).order_by("-periode").values_list("rh_actuel", flat=True).first()
    if previous is not None and rh_actuel < previous:
        raise ValidationError("Le compteur RH ne peut pas être inférieur au dernier relevé du groupe.")


def _sync_generator_current_from_readings(site, groupe_code, actor_id=None):
    generator = GeneratorRecord.objects.filter(site=site, code=groupe_code).order_by("-created_at").first()
    latest = GeneratorMonthlyReading.objects.filter(site=site, groupe_code=groupe_code).order_by("-periode").first()
    if not generator:
        return
    if not latest:
        # Plus aucun relevé : la ligne de suivi n'existe plus, la fiche (dont le RH de la dernière PM) disparaît avec elle.
        generator.delete()
        return
    values = {"rh_actuel": latest.rh_actuel}
    _calculate_generator_values(values, generator)
    generator.mois_releve = latest.periode
    generator.rh_actuel = values["rh_actuel"]
    generator.rh_depuis_derniere_pm = values["rh_depuis_derniere_pm"]
    generator.rh_prochaine_pm = values["rh_prochaine_pm"]
    generator.etat = values["etat"]
    generator.commentaires = latest.commentaires
    if actor_id is not None:
        generator.updated_by = actor_id
    generator.save(update_fields=["mois_releve", "rh_actuel", "rh_depuis_derniere_pm", "rh_prochaine_pm", "etat", "commentaires", "updated_by", "updated_at"])
