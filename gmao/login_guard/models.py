from django.db import models


class LoginBucket(models.Model):
    # HMAC keys avoid storing raw IP addresses or email addresses.
    key = models.CharField(max_length=64, primary_key=True)
    window_started = models.DateTimeField(db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    next_allowed = models.DateTimeField()

    class Meta:
        db_table = "gmao_login_buckets"
