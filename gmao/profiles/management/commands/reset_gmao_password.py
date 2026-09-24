"""Réinitialise un mot de passe local sans l'afficher."""

from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from profiles.local_auth import set_local_password, validate_temporary_password
from profiles.models import UserProfile


class Command(BaseCommand):
    help = "Définit un mot de passe permanent pour un identifiant GMAO local."

    def add_arguments(self, parser):
        parser.add_argument("email", help="Identifiant e-mail du profil à réinitialiser.")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        try:
            profile = UserProfile.objects.get(email__iexact=email, active=True)
        except UserProfile.DoesNotExist as error:
            raise CommandError("Profil actif introuvable pour cet identifiant.") from error

        password = getpass("Nouveau mot de passe (12 caractères minimum) : ")
        confirmation = getpass("Confirmer le mot de passe : ")
        if password != confirmation:
            raise CommandError("Les deux mots de passe ne correspondent pas.")
        validate_temporary_password(password)
        set_local_password(profile.id, password)
        self.stdout.write(self.style.SUCCESS("Mot de passe local défini pour ce profil."))
