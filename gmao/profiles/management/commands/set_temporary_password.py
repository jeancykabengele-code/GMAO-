"""Initialise ou renouvelle un mot de passe temporaire local sans l'afficher."""
import getpass
from django.core.management.base import BaseCommand, CommandError
from profiles.local_auth import set_temporary_password
from profiles.models import UserProfile


class Command(BaseCommand):
    help = "Définit un mot de passe temporaire, obligatoire à changer à la première connexion."

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, **options):
        try:
            profile = UserProfile.objects.get(email__iexact=options["email"], active=True)
        except UserProfile.DoesNotExist as error:
            raise CommandError("Aucun profil actif ne correspond à cette adresse e-mail.") from error
        password = getpass.getpass("Mot de passe temporaire (12 caractères minimum) : ")
        confirmation = getpass.getpass("Confirmer le mot de passe temporaire : ")
        if password != confirmation:
            raise CommandError("Les deux mots de passe ne correspondent pas.")
        set_temporary_password(profile.id, password)
        self.stdout.write(self.style.SUCCESS(f"Mot de passe temporaire défini pour {profile.email}."))
