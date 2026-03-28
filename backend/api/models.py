from datetime import timedelta
import uuid

from django.conf import settings
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


class ClinicalDecisionEvent(models.Model):
    DECISION_ACCEPTED = "accepted"
    DECISION_APPLIED = "applied"
    DECISION_REJECTED = "rejected"
    DECISION_DISMISSED = "dismissed"
    DECISION_CHOICES = [
        (DECISION_ACCEPTED, "Accepted"),
        (DECISION_APPLIED, "Applied"),
        (DECISION_REJECTED, "Rejected"),
        (DECISION_DISMISSED, "Dismissed"),
    ]

    decision_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    handover_id = models.CharField(max_length=255, blank=True, db_index=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    actor_id = models.CharField(max_length=255, db_index=True)
    actor_role = models.CharField(max_length=64, blank=True)
    suggestion_source = models.CharField(max_length=64, db_index=True)
    suggestion_version = models.CharField(max_length=64, blank=True)
    decision = models.CharField(max_length=16, choices=DECISION_CHOICES, db_index=True)
    reason_code = models.CharField(max_length=64, blank=True)
    note = models.CharField(max_length=240, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["unit_id", "created_at"], name="idx_clin_dec_unit_created"),
            models.Index(fields=["patient_id", "created_at"], name="idx_clin_dec_patient_created"),
            models.Index(fields=["suggestion_source", "created_at"], name="idx_clin_dec_source_created"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return (
            "ClinicalDecisionEvent("
            f"decision_id={self.decision_id}, suggestion_source={self.suggestion_source}, decision={self.decision}"
            ")"
        )


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
    STATUS_QUEUED = "queued"
    STATUS_RETRY = "retry"
    STATUS_DELIVERED = "delivered"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_QUEUED, "Queued"),
        (STATUS_RETRY, "Retry scheduled"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_FAILED, "Failed"),
    ]

    request_id = models.CharField(max_length=255, unique=True)
    idempotency_key = models.CharField(max_length=255, db_index=True)
    bundle_id = models.CharField(max_length=255, db_index=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    payload_json = models.JSONField()
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    last_http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["status", "next_retry_at"], name="idx_icea_status_retry"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"IceaOutboundEvent(request_id={self.request_id}, status={self.status})"

    @property
    def sent_at(self):  # pragma: no cover - backwards-compatible alias
        return self.delivered_at


class HandoverBundleRecord(models.Model):
    bundle_id = models.CharField(max_length=255, unique=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    request_id = models.CharField(max_length=255, unique=True)
    bundle_json = models.JSONField()
    encryption_metadata = models.JSONField(null=True, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["bundle_id"], name="idx_handover_bundle_id"),
            models.Index(fields=["unit_id", "created_at"], name="idx_handover_unit_created"),
            models.Index(fields=["created_at"], name="idx_handover_created_at"),
        ]

    @staticmethod
    def default_expiry(now=None) -> timezone.datetime:
        current = now or timezone.now()
        return current + timedelta(days=settings.HANDOVER_BUNDLE_RETENTION_DAYS)

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"HandoverBundleRecord(bundle_id={self.bundle_id}, request_id={self.request_id})"


class IceaBridgeRequest(models.Model):
    STATUS_QUEUED = "queued"
    STATUS_SENT = "sent"
    STATUS_ACCEPTED = "accepted"
    STATUS_PENDING = "pending"
    STATUS_SCORED = "scored"
    STATUS_FAILED = "failed"
    STATUS_STALE = "stale"
    STATUS_CHOICES = [
        (STATUS_QUEUED, "Queued"),
        (STATUS_SENT, "Sent"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_PENDING, "Pending"),
        (STATUS_SCORED, "Scored"),
        (STATUS_FAILED, "Failed"),
        (STATUS_STALE, "Stale"),
    ]

    SCORING_MODE_IMMEDIATE = "immediate_provisional"
    SCORING_MODE_ENRICHED = "enriched_followup"
    SCORING_MODE_CHOICES = [
        (SCORING_MODE_IMMEDIATE, "Immediate / provisional"),
        (SCORING_MODE_ENRICHED, "Enriched / follow-up"),
    ]

    bridge_request_id = models.CharField(max_length=255, unique=True)
    request_id = models.CharField(max_length=255, db_index=True)
    bundle_id = models.CharField(max_length=255, db_index=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    encounter_id = models.CharField(max_length=255, blank=True, db_index=True)
    composition_id = models.CharField(max_length=255, blank=True)
    episode_id = models.CharField(max_length=255, blank=True, db_index=True)
    shift = models.CharField(max_length=64, blank=True, db_index=True)
    scoring_mode = models.CharField(
        max_length=32,
        choices=SCORING_MODE_CHOICES,
        default=SCORING_MODE_IMMEDIATE,
        db_index=True,
    )
    idempotency_key = models.CharField(max_length=255, db_index=True)
    payload_hash = models.CharField(max_length=64, db_index=True)
    payload_json = models.JSONField()
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True)
    provisional = models.BooleanField(default=True)
    insufficient_evidence = models.BooleanField(default=False)
    contract_version = models.CharField(max_length=64, blank=True)
    formula_version = models.CharField(max_length=64, blank=True)
    score_summary_json = models.JSONField(null=True, blank=True)
    warnings_json = models.JSONField(default=list, blank=True)
    remote_refs_json = models.JSONField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    last_http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["unit_id", "updated_at"], name="idx_icea_bridge_unit_upd"),
            models.Index(fields=["bundle_id", "updated_at"], name="idx_icea_bridge_bundle_upd"),
            models.Index(fields=["status", "scoring_mode"], name="idx_icea_bridge_status_mode"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return (
            "IceaBridgeRequest("
            f"bridge_request_id={self.bridge_request_id}, status={self.status}, scoring_mode={self.scoring_mode}"
            ")"
        )

class IceaPipelineSnapshot(models.Model):
    STATUS_ACCEPTED = "accepted"
    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_RETRY = "retry"
    STATUS_DELIVERED = "delivered"
    STATUS_SUCCEEDED = "succeeded"
    STATUS_FAILED = "failed"
    STATUS_EMPTY = "empty"
    STATUS_NOT_CONFIGURED = "not-configured"
    STATUS_CHOICES = [
        (STATUS_ACCEPTED, "Accepted by HANDOVER"),
        (STATUS_QUEUED, "Queued"),
        (STATUS_RUNNING, "Running"),
        (STATUS_RETRY, "Retry scheduled"),
        (STATUS_DELIVERED, "Delivered to ICEA"),
        (STATUS_SUCCEEDED, "Succeeded"),
        (STATUS_FAILED, "Failed"),
        (STATUS_EMPTY, "Empty"),
        (STATUS_NOT_CONFIGURED, "Not configured"),
    ]

    request_id = models.CharField(max_length=255, unique=True)
    bundle_id = models.CharField(max_length=255, db_index=True)
    patient_id = models.CharField(max_length=255, db_index=True)
    unit_id = models.CharField(max_length=255, db_index=True)
    visible_status = models.CharField(
        max_length=32,
        choices=STATUS_CHOICES,
        default=STATUS_ACCEPTED,
        db_index=True,
    )
    last_stage = models.CharField(max_length=64, default="handover")
    stage_statuses = models.JSONField(default=dict, blank=True)
    remote_refs = models.JSONField(null=True, blank=True)
    dashboard_summary_json = models.JSONField(null=True, blank=True)
    causal_report_json = models.JSONField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    last_http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["unit_id", "updated_at"], name="idx_icea_ps_unit_upd"),
            models.Index(fields=["patient_id", "updated_at"], name="idx_icea_ps_patient_upd"),
            models.Index(fields=["bundle_id", "updated_at"], name="idx_icea_ps_bundle_upd"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"IceaPipelineSnapshot(request_id={self.request_id}, last_stage={self.last_stage})"


class IceaPipelineEvent(models.Model):
    snapshot = models.ForeignKey(
        IceaPipelineSnapshot,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    request_id = models.CharField(max_length=255, blank=True, db_index=True)
    bundle_id = models.CharField(max_length=255, blank=True, db_index=True)
    patient_id = models.CharField(max_length=255, blank=True, db_index=True)
    unit_id = models.CharField(max_length=255, blank=True, db_index=True)
    stage = models.CharField(max_length=64, db_index=True)
    action = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=32, db_index=True)
    source = models.CharField(max_length=64, blank=True)
    actor_sub = models.CharField(max_length=255, blank=True)
    detail = models.CharField(max_length=255, blank=True)
    http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    payload_json = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["unit_id", "created_at"], name="idx_icea_event_unit_created"),
            models.Index(fields=["stage", "created_at"], name="idx_icea_event_stage_created"),
        ]

    def __str__(self) -> str:  # pragma: no cover - representation helper
        return f"IceaPipelineEvent(stage={self.stage}, status={self.status})"



