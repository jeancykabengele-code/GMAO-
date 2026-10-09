"""Correspondance des ressources de l'API, des modèles et des noms de champs."""

from ..models import DatacenterProblem, Equipment, FuelDelivery, FuelMonthlySummary, FuelRecord, GeneratorFuelConsumption, GeneratorMonthlyReading, GeneratorRecord, Intervention, PueRecord, SparePartOperation, Ticket


RESOURCE_MODELS = {
    "equipements": Equipment,
    "tickets": Ticket,
    "groupes-electrogenes": GeneratorRecord,
    "releves-rh-ge": GeneratorMonthlyReading,
    "fuel-ge": FuelRecord,
    "consommations-groupes-ge": GeneratorFuelConsumption,
    "fuel-ravitaillements": FuelDelivery,
    "fuel-summary": FuelMonthlySummary,
    "pue": PueRecord,
    "problemes-datacenter": DatacenterProblem,
    "interventions": Intervention,
    "pieces-rechange": SparePartOperation,
}


CAMEL_TO_SNAKE = {
    "dateMiseEnService": "date_mise_en_service",
    "marqueModele": "marque_modele",
    "typeGe": "type_ge",
    "moisReleve": "mois_releve",
    "dateDernierePm": "date_derniere_pm",
    "createdAt": "created_at",
    "updatedAt": "updated_at",
    "rhActuel": "rh_actuel",
    "rhDernierePm": "rh_derniere_pm",
    "rhDepuisDernierePm": "rh_depuis_derniere_pm",
    "rhProchainePm": "rh_prochaine_pm",
    "retardSignale": "retard_signale",
    "dateRavitaillement": "date_ravitaillement",
    "bonLivraison": "bon_livraison",
    "typeCarburant": "type_carburant",
    "quantiteRecue": "quantite_recue",
    "stockAvant": "stock_avant",
    "stockApres": "stock_apres",
    "numeroCiterne": "numero_citerne",
    "receptionnePar": "receptionne_par",
    "differenceStock": "difference_stock",
    "stockInitial": "stock_initial",
    "stockFinal": "stock_final",
    "heuresGe": "heures_ge",
    "litresHeure": "litres_heure",
    "snelKwh": "snel_kwh",
    "disponibiliteGrid": "disponibilite_grid",
    "groupeCode": "groupe_code",
    "consommationLitres": "consommation_litres",
    "dateReleve": "date_releve",
    "heureReleve": "heure_releve",
    "itKw": "it_kw",
    "totalKw": "total_kw",
    "besoinSpare": "besoin_spare",
    "prochaineEtape": "prochaine_etape",
    "ticketNumber": "ticket_number",
    "travailRealise": "travail_realise",
    "dureeHeures": "duree_heures",
}


SNAKE_TO_CAMEL = {value: key for key, value in CAMEL_TO_SNAKE.items()}


PROTECTED_FIELDS = {"id", "created_by", "created_at", "updated_by", "updated_at"}
