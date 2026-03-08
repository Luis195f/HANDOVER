from django.urls import path

from backend.audit.views import AuditEventsIngestView
from .views_ai import AudioToFHIRView, SuggestInterventionsView, SummarizeSbarView, TranscribeView
from .views_icea import (
    IceaDashboardSummaryView,
    IceaPipelineActionView,
    IceaPipelineEventsView,
    IceaPipelineStatusView,
)
from .views_icea_bridge import (
    IceaBridgeRetryView,
    IceaBridgeStatusDetailView,
    IceaBridgeStatusQueryView,
    IceaBridgeSummaryView,
)

from .views import (
    AuditLogView,
    BundleView,
    CapabilitiesView,
    DashboardView,
    HandoverEtlReadView,
    HandoverTimingMetricsView,
    MedicationStatementView,
    NandaCatalogView,
    OAuthRefreshView,
    PatientView,
    PatientsView,
)

urlpatterns = [
    path("fhir/patient", PatientView.as_view(), name="patient"),
    path("patients", PatientsView.as_view(), name="patients-no-slash"),
    path("patients/", PatientsView.as_view(), name="patients"),
    path("catalogs/nanda", NandaCatalogView.as_view(), name="catalog-nanda"),
    path("catalogs/nanda/", NandaCatalogView.as_view(), name="catalog-nanda-slash"),
    path("fhir/medicationstatement", MedicationStatementView.as_view(), name="medicationstatement"),

    path("fhir/transaction", BundleView.as_view(), name="fhir-transaction"),
    path("fhir/transaction/", BundleView.as_view(), name="fhir-transaction-slash"),
    path("handover/<str:bundle_id>", HandoverEtlReadView.as_view(), name="handover-etl-read"),
    path("handover/<str:bundle_id>/", HandoverEtlReadView.as_view(), name="handover-etl-read-slash"),

    path("icea/status", IceaPipelineStatusView.as_view(), name="icea-pipeline-status"),
    path("icea/status/", IceaPipelineStatusView.as_view(), name="icea-pipeline-status-slash"),
    path("icea/events", IceaPipelineEventsView.as_view(), name="icea-pipeline-events"),
    path("icea/events/", IceaPipelineEventsView.as_view(), name="icea-pipeline-events-slash"),
    path("icea/dashboard-summary", IceaDashboardSummaryView.as_view(), name="icea-dashboard-summary"),
    path("icea/dashboard-summary/", IceaDashboardSummaryView.as_view(), name="icea-dashboard-summary-slash"),
    path("icea/actions/<str:action>", IceaPipelineActionView.as_view(), name="icea-pipeline-action"),
    path("icea/actions/<str:action>/", IceaPipelineActionView.as_view(), name="icea-pipeline-action-slash"),
    path("icea/bridge/status", IceaBridgeStatusQueryView.as_view(), name="icea-bridge-status-query"),
    path("icea/bridge/status/", IceaBridgeStatusQueryView.as_view(), name="icea-bridge-status-query-slash"),
    path("icea/bridge/status/<str:handover_id>", IceaBridgeStatusDetailView.as_view(), name="icea-bridge-status-detail"),
    path("icea/bridge/status/<str:handover_id>/", IceaBridgeStatusDetailView.as_view(), name="icea-bridge-status-detail-slash"),
    path("icea/bridge/summary/<str:handover_id>", IceaBridgeSummaryView.as_view(), name="icea-bridge-summary"),
    path("icea/bridge/summary/<str:handover_id>/", IceaBridgeSummaryView.as_view(), name="icea-bridge-summary-slash"),
    path("icea/bridge/retry/<int:bridge_id>", IceaBridgeRetryView.as_view(), name="icea-bridge-retry"),
    path("icea/bridge/retry/<int:bridge_id>/", IceaBridgeRetryView.as_view(), name="icea-bridge-retry-slash"),
    path("audit", AuditLogView.as_view(), name="audit-log"),
    path("audit/", AuditLogView.as_view(), name="audit-log-slash"),
    path("audit/events", AuditEventsIngestView.as_view(), name="audit-events"),
    path("audit/events/", AuditEventsIngestView.as_view(), name="audit-events-slash"),
    path("me/capabilities", CapabilitiesView.as_view(), name="me-capabilities"),
    path("me/capabilities/", CapabilitiesView.as_view(), name="me-capabilities-slash"),
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path("metrics/handover-time", HandoverTimingMetricsView.as_view(), name="handover-time-metrics"),
    path("metrics/handover-time/", HandoverTimingMetricsView.as_view(), name="handover-time-metrics-slash"),
    path("dashboard/", DashboardView.as_view(), name="dashboard-slash"),
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

