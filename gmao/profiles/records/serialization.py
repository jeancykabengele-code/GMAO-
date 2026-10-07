"""Lecture et écriture des fiches : JSON, champs autorisés, arrondis et instantané de l'historique."""

import json
from datetime import date, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.http import JsonResponse

from .constants import CAMEL_TO_SNAKE, PROTECTED_FIELDS, RESOURCE_MODELS, SNAKE_TO_CAMEL


def _round_decimal_fields(record):
    """Ramène chaque DecimalField à sa précision avant full_clean() (valeurs déjà stockées ou calculées)."""
    for field in record._meta.concrete_fields:
        if isinstance(field, models.DecimalField):
            value = getattr(record, field.attname)
            if isinstance(value, Decimal):
                setattr(record, field.attname, value.quantize(Decimal(1).scaleb(-field.decimal_places)))


HISTORY_IGNORED_FIELDS = {"id", "createdAt", "updatedAt"}


HISTORY_MAX_TEXT = 500


def _history_snapshot(record):
    """Valeurs d'une fiche conservées pour l'historique des modifications (textes longs tronqués)."""
    snapshot = {}
    for key, value in _serialize(record).items():
        if key in HISTORY_IGNORED_FIELDS:
            continue
        if isinstance(value, str) and len(value) > HISTORY_MAX_TEXT:
            value = value[:HISTORY_MAX_TEXT] + "…"
        snapshot[key] = value
    return snapshot


def _resource_model(resource):
    return RESOURCE_MODELS.get(resource)


def _serialize(record):
    result = {}
    for field in record._meta.concrete_fields:
        if field.name in {"created_by", "updated_by"}:
            continue
        value = getattr(record, field.name)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        elif isinstance(value, Decimal):
            value = float(value)
        elif value is not None and field.name == "id":
            value = str(value)
        result[SNAKE_TO_CAMEL.get(field.name, field.name)] = value
    return result


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ValidationError("Le corps JSON est invalide.") from error
    if not isinstance(value, dict):
        raise ValidationError("Le corps doit être un objet JSON.")
    return value


def _clean_values(model_class, payload):
    fields = {field.name: field for field in model_class._meta.concrete_fields}
    values = {}
    for key, value in payload.items():
        field_name = CAMEL_TO_SNAKE.get(key, key)
        if field_name in PROTECTED_FIELDS:
            continue
        field = fields.get(field_name)
        if not field:
            raise ValidationError(f"Champ inconnu : {key}.")
        if value == "" and field.null:
            value = None
        cleaned = field.to_python(value)
        if isinstance(field, models.DecimalField) and isinstance(cleaned, Decimal):
            # DecimalField.to_python() converts a JSON float through a binary
            # approximation (e.g. 1000.1 -> Decimal('1000.100000000000')),
            # which then fails the field's own decimal_places validation.
            # Round back to what the field actually allows before it is used.
            cleaned = cleaned.quantize(Decimal(1).scaleb(-field.decimal_places))
        values[field_name] = cleaned
    if not values.get("site"):
        raise ValidationError("Le site est obligatoire.")
    return values


def _error(error, status=400):
    detail = error.messages[0] if isinstance(error, ValidationError) else str(error)
    return JsonResponse({"status": status, "code": "record_rejected", "detail": detail}, status=status)
