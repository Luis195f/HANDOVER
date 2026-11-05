from django.db import models
from django.utils import timezone


class AuditEventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValueError("AuditEvent is append-only and cannot be updated.")

    def delete(self):
        raise ValueError("AuditEvent is append-only and cannot be deleted ordinarily.")

    def prune_before(self, cutoff):
        """Explicit retention path; ordinary queryset deletes remain forbidden."""
        expired = self.filter(timestamp__lt=cutoff)
        return super(AuditEventQuerySet, expired).delete()


class AuditEvent(models.Model):
    objects = AuditEventQuerySet.as_manager()
    id = models.BigAutoField(primary_key=True)
    event_type = models.CharField(max_length=255, db_index=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    user_sub = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    scopes = models.TextField(blank=True)
    resource_type = models.CharField(max_length=255, blank=True)
    resource_id = models.CharField(max_length=255, blank=True, db_index=True)
    action = models.CharField(max_length=255)
    status = models.CharField(max_length=32)
    http_status = models.IntegerField(null=True)
    ip = models.CharField(max_length=255, blank=True)
    user_agent = models.TextField(blank=True)
    request_id = models.CharField(max_length=255, blank=True, db_index=True)
    payload_hash = models.CharField(max_length=64, blank=True)
    payload_size = models.IntegerField(null=True, blank=True)
    meta = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("AuditEvent is append-only and cannot be updated once persisted.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("AuditEvent is append-only and cannot be deleted from the model layer.")

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"AuditEvent(event_type={self.event_type}, status={self.status})"
