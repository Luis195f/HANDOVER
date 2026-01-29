from django.db import models
from django.utils import timezone


class HandoverSignatureAudit(models.Model):
    user_id = models.CharField(max_length=255, blank=True)
    bundle_hash = models.CharField(max_length=64, unique=True)
    signed_at = models.DateTimeField()
    signature = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-signed_at"]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"HandoverSignatureAudit(bundle_hash={self.bundle_hash})"


class AuditEvent(models.Model):
    type = models.CharField(max_length=64)
    user_id = models.CharField(max_length=255)
    patient_id = models.CharField(max_length=255, blank=True)
    unit_id = models.CharField(max_length=255, blank=True)
    shift_code = models.CharField(max_length=64, blank=True)
    meta = models.JSONField(null=True, blank=True)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at"]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"AuditEvent(type={self.type}, user_id={self.user_id})"
