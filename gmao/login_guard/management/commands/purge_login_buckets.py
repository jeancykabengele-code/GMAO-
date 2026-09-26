from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from login_guard.models import LoginBucket


class Command(BaseCommand):
    help = "Supprime les compteurs de connexion expirés depuis plus de 24 heures."

    def handle(self, *args, **options):
        # Never delete an active window or reset an active limit.
        count, _ = LoginBucket.objects.filter(
            window_started__lt=timezone.now() - timedelta(hours=24),
        ).delete()
        self.stdout.write(f"{count} compteurs de connexion expirés supprimés.")
