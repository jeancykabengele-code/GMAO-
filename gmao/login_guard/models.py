from django.db import models


class LoginBucket(models.Model):
    # HMAC keys avoid storing raw IP addresses or email addresses.
    key = models.CharField(max_length=64, primary_key=True)
    window_started = models.DateTimeField(db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    next_allowed = models.DateTimeField()

    class Meta:
        db_table = "gmao_login_buckets"


class PasswordHistory(models.Model):
    """Hachages récents conservés uniquement pour empêcher leur réutilisation."""

    profile_id = models.UUIDField(db_index=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "gmao_password_history"
        ordering = ("-created_at", "-id")
