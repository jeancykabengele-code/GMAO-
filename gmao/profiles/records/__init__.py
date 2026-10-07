"""Fiches métier de l'API (équipements, tickets, groupes électrogènes, Fuel, PUE…)."""

from .constants import RESOURCE_MODELS
from .endpoints import record_collection, record_detail

__all__ = ["RESOURCE_MODELS", "record_collection", "record_detail"]
