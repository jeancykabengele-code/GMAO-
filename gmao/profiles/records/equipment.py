"""Génération des codes d'équipement."""

import re
import unicodedata

from ..models import Equipment, Site


def _equipment_site_code(site):
    configured_code = Site.objects.filter(name=site, active=True).values_list("code", flat=True).first()
    source = configured_code or site
    normalized = unicodedata.normalize("NFKD", source).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z0-9]", "", normalized.upper()) or "SITE"


def _next_equipment_code(site_code, existing_codes):
    prefix = f"EQ-{site_code}-"
    numbers = []
    for code in existing_codes:
        suffix = code.removeprefix(prefix)
        if code.startswith(prefix) and suffix.isdigit():
            numbers.append(int(suffix))
    return f"{prefix}{max(numbers, default=0) + 1:04d}"


def _generate_equipment_code(site):
    site_code = _equipment_site_code(site)
    prefix = f"EQ-{site_code}-"
    existing_codes = Equipment.objects.filter(site=site, code__startswith=prefix).values_list("code", flat=True)
    return _next_equipment_code(site_code, existing_codes)
