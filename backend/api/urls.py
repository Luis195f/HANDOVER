from django.urls import path

from backend.audit.views import AuditEventsIngestView
from .views_ai import AudioToFHIRView, SuggestInterventionsView, SummarizeSbarView, TranscribeView

from .views import (
    AuditLogView,
    BundleView,
    CapabilitiesView,
    MedicationStatementView,
    OAuthRefreshView,
    PatientView,
)

urlpatterns = [
    path("fhir/patient", PatientView.as_view(), name="patient"),
    path("fhir/medicationstatement", MedicationStatementView.as_view(), name="medicationstatement"),

    # Endpoint principal (sin slash)
    path("fhir/transaction", BundleView.as_view(), name="fhir-transaction"),
    # (opcional) también aceptar con slash final
    path("fhir/transaction/", BundleView.as_view(), name="fhir-transaction-slash"),

    path("audit", AuditLogView.as_view(), name="audit-log"),
    path("audit/", AuditLogView.as_view(), name="audit-log-slash"),
    path("audit/events", AuditEventsIngestView.as_view(), name="audit-events"),
    path("audit/events/", AuditEventsIngestView.as_view(), name="audit-events-slash"),
    path("me/capabilities", CapabilitiesView.as_view(), name="me-capabilities"),
    path("me/capabilities/", CapabilitiesView.as_view(), name="me-capabilities-slash"),
    path("auth/refresh", OAuthRefreshView.as_view(), name="auth-refresh"),
    path("auth/refresh/", OAuthRefreshView.as_view(), name="auth-refresh-slash"),
    path("ai/transcribe", TranscribeView.as_view(), name="ai-transcribe"),
    path("ai/transcribe/", TranscribeView.as_view(), name="ai-transcribe-slash"),
    path("ai/summarize-sbar", SummarizeSbarView.as_view(), name="ai-summarize-sbar"),
    path("ai/summarize-sbar/", SummarizeSbarView.as_view(), name="ai-summarize-sbar-slash"),
    path("ai/suggest-interventions", SuggestInterventionsView.as_view(), name="ai-suggest-interventions"),
    path("ai/suggest-interventions/", SuggestInterventionsView.as_view(), name="ai-suggest-interventions-slash"),
    path("upload/audio-to-fhir", AudioToFHIRView.as_view(), name="upload-audio-to-fhir"),
    path("upload/audio-to-fhir/", AudioToFHIRView.as_view(), name="upload-audio-to-fhir-slash"),
]
