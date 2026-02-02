from django.db import models
from django.utils import timezone


class AuditEvent(models.Model):
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

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"AuditEvent(event_type={self.event_type}, status={self.status})"
