"""Calcul du PUE à partir du relevé journalier de DC Pigeon (puissances en kW).

IT déduit = TGBT A + B − climatisation − charges tertiaires ; PUE = (TGBT A + B) ÷ IT déduit."""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError


PUE_SITE = "Pigeon"
# Kinshasa n'a pas d'heure d'été : un décalage fixe évite de dépendre de la base de fuseaux du serveur.
SITE_TIMEZONE = timezone(timedelta(hours=1))
COS_PHI = Decimal("0.9")
AC_VOLTAGE = Decimal("400")
SQRT3 = Decimal(str(math.sqrt(3)))

KW_PLACES = Decimal("0.001")
PUE_PLACES = Decimal("0.001")
GAP_PLACES = Decimal("0.1")


REQUIRED_ROLES = ("total", "cooling", "tertiary")


@dataclass(frozen=True)
class PueLine:
    code: str
    label: str
    kind: str  # "ac" (triphasé) ou "dc"
    role: str  # avr | it | pdf | cooling | tertiary | total

    @property
    def required(self):
        """Le PUE se déduit du total site et des charges hors IT ; UPS, redresseurs et PDF ne servent qu'au contrôle."""
        return self.role in REQUIRED_ROLES


def _lines():
    lines = [
        PueLine("avr_a", "AVR A", "ac", "avr"),
        PueLine("avr_b", "AVR B", "ac", "avr"),
        PueLine("ups_a", "UPS A", "ac", "it"),
        PueLine("ups_b", "UPS B", "ac", "it"),
        PueLine("redresseurs_a", "Redresseurs A", "dc", "it"),
        PueLine("redresseurs_b", "Redresseurs B", "dc", "it"),
    ]
    lines += [PueLine(f"pdf_ac_{voie}{n}", f"PDF AC {voie.upper()}{n}", "ac", "pdf") for voie in "ab" for n in (1, 2)]
    lines += [PueLine(f"pdf_dc_{voie}{n}", f"PDF DC {voie.upper()}{n}", "dc", "pdf") for voie in "ab" for n in (1, 2, 3, 4)]
    lines += [
        PueLine("clim_a", "TDBT Climatisation A", "ac", "cooling"),
        PueLine("clim_b", "TDBT Climatisation B", "ac", "cooling"),
        PueLine("tertiaire", "Charges tertiaires", "ac", "tertiary"),
        PueLine("tgbt_a", "TGBT A", "ac", "total"),
        PueLine("tgbt_b", "TGBT B", "ac", "total"),
    ]
    return tuple(lines)


PUE_LINES = _lines()
LINES_BY_CODE = {line.code: line for line in PUE_LINES}


def _number(value, label, field):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{label} : {field} invalide.")
    try:
        number = Decimal(str(value).replace(",", "."))
    except InvalidOperation as error:
        raise ValidationError(f"{label} : {field} invalide.") from error
    if not number.is_finite() or number < 0:
        raise ValidationError(f"{label} : {field} doit être un nombre positif ou nul.")
    return number


def _kw_from_amps(line, amps, volts, cos_phi=None):
    if line.kind == "dc":
        return amps * volts / 1000
    return SQRT3 * volts * amps * (cos_phi if cos_phi is not None else COS_PHI) / 1000


def _is_empty(raw):
    return raw is None or (isinstance(raw, dict) and all(
        raw.get(field) is None or (isinstance(raw.get(field), str) and not raw.get(field).strip())
        for field in ("kwLus", "a", "v", "cosPhi")
    ))


def _empty_result():
    return {"kwLus": None, "a": None, "v": None, "cosPhi": None, "kw": None, "origine": "", "ecart": None}


def _compute_line(line, raw):
    if not line.required and _is_empty(raw):
        return _empty_result()
    if not isinstance(raw, dict):
        raise ValidationError(f"{line.label} : relevé manquant.")
    kw_read = _number(raw.get("kwLus"), line.label, "les kW lus")
    amps = _number(raw.get("a"), line.label, "les ampères")
    volts = _number(raw.get("v"), line.label, "la tension")
    # Le cos φ ne concerne que le triphasé : lu sur l'équipement avec les ampères, 0,9 à défaut.
    cos_phi = _number(raw.get("cosPhi"), line.label, "le cos φ") if line.kind == "ac" else None
    if cos_phi is not None and not 0 < cos_phi <= 1:
        raise ValidationError(f"{line.label} : le cos φ doit être compris entre 0 (exclu) et 1.")
    if line.kind == "ac" and volts is None:
        volts = AC_VOLTAGE
        entered_volts = None
    else:
        entered_volts = volts
    calculated = None
    if amps is not None and volts is not None:
        calculated = _kw_from_amps(line, amps, volts, cos_phi)
    if kw_read is None and calculated is None:
        if line.kind == "dc" and amps is not None:
            raise ValidationError(f"{line.label} : la tension (V) est obligatoire avec les ampères.")
        raise ValidationError(f"{line.label} : renseigner les kW lus, ou les ampères (et la tension).")
    gap = None
    if kw_read is not None and calculated is not None and calculated > 0:
        gap = ((kw_read - calculated) / calculated * 100).quantize(GAP_PLACES)
    if kw_read is not None:
        retained, origin = kw_read, "Lu"
    else:
        retained, origin = calculated, "Calculé"
    return {
        "kwLus": float(kw_read) if kw_read is not None else None,
        "a": float(amps) if amps is not None else None,
        "v": float(entered_volts) if entered_volts is not None else None,
        "cosPhi": float(cos_phi) if cos_phi is not None else None,
        "kw": float(retained.quantize(KW_PLACES)),
        "origine": origin,
        "ecart": float(gap) if gap is not None else None,
    }


def _compute_lines(mesures):
    if not isinstance(mesures, dict):
        raise ValidationError("Les mesures du relevé sont obligatoires.")
    unknown = sorted(set(mesures) - set(LINES_BY_CODE))
    if unknown:
        raise ValidationError(f"Équipement inconnu dans le relevé : {unknown[0]}.")
    return {line.code: _compute_line(line, mesures.get(line.code)) for line in PUE_LINES}


def _sum_kw(computed, role):
    return sum(
        (Decimal(str(computed[line.code]["kw"])) for line in PUE_LINES if line.role == role and computed[line.code]["kw"] is not None),
        Decimal(0),
    )


def _calculate_pue_values(values, record=None, now=None):
    """Complète `values` : date et heure du relevé (à la création), kW retenus, IT, total et PUE."""
    site = values.get("site", getattr(record, "site", None))
    if site != PUE_SITE:
        raise ValidationError(f"Le PUE se renseigne uniquement pour le site {PUE_SITE}.")
    mesures = values.get("mesures", getattr(record, "mesures", None))
    computed = _compute_lines(mesures)

    if record is None:
        local_now = (now or datetime.now(timezone.utc)).astimezone(SITE_TIMEZONE)
        values["date_releve"] = local_now.date()
        values["heure_releve"] = local_now.time().replace(second=0, microsecond=0)
    else:
        for field in ("date_releve", "heure_releve"):
            values.pop(field, None)

    # L'IT se déduit du total site : TGBT A + B, moins la climatisation et les charges tertiaires.
    total_kw = _sum_kw(computed, "total")
    non_it_kw = _sum_kw(computed, "cooling") + _sum_kw(computed, "tertiary")
    it_kw = total_kw - non_it_kw
    if total_kw <= 0:
        raise ValidationError("La puissance totale (TGBT A + B) doit être supérieure à zéro.")
    if it_kw <= 0:
        raise ValidationError(
            "La puissance IT déduite (TGBT A + B − climatisation − charges tertiaires) doit être supérieure à zéro."
        )
    values["mesures"] = computed
    values["it_kw"] = it_kw.quantize(KW_PLACES)
    values["total_kw"] = total_kw.quantize(KW_PLACES)
    values["pue"] = (total_kw / it_kw).quantize(PUE_PLACES)
    return values
