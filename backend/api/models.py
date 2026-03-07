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


class ClientAuditEvent(models.Model):
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
        db_table = "api_auditevent"

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"ClientAuditEvent(type={self.type}, user_id={self.user_id})"


class DemoPatient(models.Model):
    external_id = models.CharField(max_length=64, unique=True)
    given_name = models.CharField(max_length=128)
    family_name = models.CharField(max_length=128)
    gender = models.CharField(max_length=32, default="unknown")
    birth_date = models.DateField(null=True, blank=True)
    unit_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["family_name", "given_name"]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"DemoPatient(external_id={self.external_id})"

    def to_fhir(self) -> dict:
        payload = {
            "resourceType": "Patient",
            "id": self.external_id,
            "name": [{"use": "official", "family": self.family_name, "given": [self.given_name]}],
            "gender": (self.gender or "unknown").lower(),
        }
        if self.birth_date:
            payload["birthDate"] = self.birth_date.isoformat()
        if self.unit_id:
            payload["extension"] = [
                {
                    "url": "https://handover.dev/fhir/StructureDefinition/unit-id",
                    "valueString": self.unit_id,
                }
            ]
        return payload


class Patient(models.Model):
    first_name = models.CharField(max_length=128)
    last_name = models.CharField(max_length=128)
    identifier = models.CharField(max_length=64, db_index=True)
    unit = models.CharField(max_length=64, db_index=True)
    service = models.CharField(max_length=128)
    room = models.CharField(max_length=64)
    active = models.BooleanField(default=True)
    external_fhir_id = models.CharField(max_length=128, null=True, blank=True)
    external_reference = models.CharField(max_length=255, null=True, blank=True)
    fhir_sync_enabled = models.BooleanField(null=True, blank=True)
    synced_to_fhir = models.BooleanField(null=True, blank=True)
    last_fhir_sync_at = models.DateTimeField(null=True, blank=True)
    fhir_sync_error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["identifier", "unit"], name="uniq_patient_identifier_unit"),
        ]
        indexes = [
            models.Index(fields=["unit", "active"], name="idx_patient_unit_active"),
        ]
        ordering = ["last_name", "first_name"]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"Patient(identifier={self.identifier}, unit={self.unit})"


class IceaOutboundEvent(models.Model):
    STATUS_PENDING = "pending"
    STATUS_SENT = "sent"
    STATUS_ERROR = "error"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_ERROR, "Error"),
    ]

    request_id = models.CharField(max_length=255, unique=True)
    bundle_id = models.CharField(max_length=255, db_index=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    payload_json = models.JSONField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["status", "next_retry_at"], name="idx_icea_status_retry"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"IceaOutboundEvent(request_id={self.request_id}, status={self.status})"
