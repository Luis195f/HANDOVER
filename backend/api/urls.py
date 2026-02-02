from django.urls import path

from backend.audit.views import AuditEventsIngestView
from .views import AuditLogView, BundleView, CapabilitiesView, MedicationStatementView, PatientView

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
]
