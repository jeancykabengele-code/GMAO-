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


class AppendOnlyAuditQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise TypeError("Le journal d’audit est immuable.")

    def delete(self):
        raise TypeError("Le journal d’audit est immuable.")


class AuditLog(models.Model):
    """Événement de sécurité append-only, sans secret ni contenu de mot de passe."""

    actor_id = models.UUIDField(null=True, blank=True, db_index=True)
    actor_email = models.CharField(max_length=254, blank=True)
    action = models.CharField(max_length=64, db_index=True)
    target_type = models.CharField(max_length=64, db_index=True)
    target_id = models.CharField(max_length=255, blank=True, db_index=True)
    result = models.CharField(max_length=16, db_index=True)
    ip_address = models.CharField(max_length=64)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    objects = AppendOnlyAuditQuerySet.as_manager()

    class Meta:
        db_table = "audit_log"
        ordering = ("-created_at", "-id")

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise TypeError("Le journal d’audit est immuable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Le journal d’audit est immuable.")
