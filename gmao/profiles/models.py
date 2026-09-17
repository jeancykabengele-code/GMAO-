import uuid

from django.db import models


class UserProfile(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.TextField()
    full_name = models.TextField()
    role = models.TextField()
    site = models.TextField(null=True, blank=True)
    active = models.BooleanField()
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "user_profiles"


class Site(models.Model):
    name = models.TextField(primary_key=True)
    code = models.TextField()
    active = models.BooleanField()

    class Meta:
        managed = False
        db_table = "sites"


class BusinessRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.TextField()
    created_by = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.UUIDField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        managed = False


class Equipment(BusinessRecord):
    code = models.TextField()
    nom = models.TextField()
    date_mise_en_service = models.DateField(null=True, blank=True)
    famille = models.TextField()
    localisation = models.TextField()
    marque_modele = models.TextField()
    etat = models.TextField()
    criticite = models.TextField()

    class Meta:
        managed = False
        db_table = "gmao_equipements"


class Ticket(BusinessRecord):
    numero = models.TextField()
    nature = models.TextField()
    equipement = models.TextField()
    date = models.DateField()
    porteur = models.TextField()
    entreprise = models.TextField()
    motif = models.TextField()
    description = models.TextField()

    class Meta:
        managed = False
        db_table = "gmao_tickets"


class GeneratorRecord(BusinessRecord):
    code = models.TextField()
    type_ge = models.TextField()
    mois_releve = models.TextField()
    date_mise_en_service = models.DateField(null=True, blank=True)
    date_derniere_pm = models.DateField(null=True, blank=True)
    rh_actuel = models.DecimalField(max_digits=14, decimal_places=2)
    rh_derniere_pm = models.DecimalField(max_digits=14, decimal_places=2)
    rh_depuis_derniere_pm = models.DecimalField(max_digits=14, decimal_places=2)
    rh_prochaine_pm = models.DecimalField(max_digits=14, decimal_places=2)
    retard_signale = models.BooleanField(default=False)
    etat = models.TextField()
    commentaires = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = "gmao_groupes_electrogenes"


class FuelRecord(BusinessRecord):
    periode = models.TextField()
    stock_initial = models.DecimalField(max_digits=16, decimal_places=3, null=True, blank=True)
    entree = models.DecimalField(max_digits=16, decimal_places=3, null=True, blank=True)
    sortie = models.DecimalField(max_digits=16, decimal_places=3)
    stock_final = models.DecimalField(max_digits=16, decimal_places=3, null=True, blank=True)
    heures_ge = models.DecimalField(max_digits=14, decimal_places=2)
    litres_heure = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    snel_kwh = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    disponibilite_grid = models.DecimalField(max_digits=7, decimal_places=2)

    class Meta:
        managed = False
        db_table = "gmao_fuel_ge"


class FuelDelivery(BusinessRecord):
    date_ravitaillement = models.DateField()
    fournisseur = models.TextField()
    bon_livraison = models.TextField()
    type_carburant = models.TextField()
    quantite_recue = models.DecimalField(max_digits=16, decimal_places=3)
    stock_avant = models.DecimalField(max_digits=16, decimal_places=3)
    stock_apres = models.DecimalField(max_digits=16, decimal_places=3)
    numero_citerne = models.TextField(blank=True)
    receptionne_par = models.TextField()
    commentaires = models.TextField(blank=True)
    difference_stock = models.BooleanField(default=False)

    class Meta:
        managed = False
        db_table = "gmao_fuel_ravitaillements"


class GeneratorFuelConsumption(BusinessRecord):
    periode = models.TextField()
    groupe_code = models.TextField()
    consommation_litres = models.DecimalField(max_digits=16, decimal_places=3)
    heures_ge = models.DecimalField(max_digits=14, decimal_places=2)
    litres_heure = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    commentaires = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = "gmao_consommations_groupes_ge"

class FuelMonthlySummary(BusinessRecord):
    periode = models.TextField()
    stock_initial = models.DecimalField(max_digits=16, decimal_places=3)
    entree = models.DecimalField(max_digits=16, decimal_places=3)
    sortie = models.DecimalField(max_digits=16, decimal_places=3)
    stock_final = models.DecimalField(max_digits=16, decimal_places=3)
    heures_ge = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        managed = False
        db_table = "gmao_fuel_monthly_summary"


class PueRecord(BusinessRecord):
    mois = models.TextField()
    energie_it = models.DecimalField(max_digits=18, decimal_places=3)
    energie_totale = models.DecimalField(max_digits=18, decimal_places=3)
    pue = models.DecimalField(max_digits=8, decimal_places=3)

    class Meta:
        managed = False
        db_table = "gmao_pue"


class DatacenterProblem(BusinessRecord):
    date = models.DateField()
    equipement = models.TextField()
    constat = models.TextField()
    statut = models.TextField()
    priorite = models.TextField()
    responsable = models.TextField()
    echeance = models.DateField(null=True, blank=True)
    besoin_spare = models.BooleanField(default=False)
    prochaine_etape = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = "gmao_problemes_datacenter"


class Intervention(BusinessRecord):
    ticket_number = models.TextField()
    date = models.DateField()
    equipement = models.TextField()
    type = models.TextField()
    travail_realise = models.TextField()
    agent = models.TextField()
    duree_heures = models.DecimalField(max_digits=10, decimal_places=2)
    statut = models.TextField()

    class Meta:
        managed = False
        db_table = "gmao_interventions"


class SparePartOperation(BusinessRecord):
    date = models.DateField()
    ticket_number = models.TextField()
    equipement = models.TextField()
    designation = models.TextField()
    quantite = models.DecimalField(max_digits=14, decimal_places=2)
    agent = models.TextField()
    statut = models.TextField()

    class Meta:
        managed = False
        db_table = "gmao_pieces_rechange"

class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient_id = models.UUIDField()
    actor_id = models.UUIDField(null=True, blank=True)
    site = models.TextField(null=True, blank=True)
    event_type = models.TextField()
    resource = models.TextField()
    resource_id = models.UUIDField(null=True, blank=True)
    title = models.TextField()
    message = models.TextField()
    severity = models.TextField(default='info')
    dedupe_key = models.TextField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'gmao_notifications'
