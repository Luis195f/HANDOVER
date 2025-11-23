from django.urls import path

from .views import MedicationStatementView, PatientView

urlpatterns = [
    path("fhir/Patient/", PatientView.as_view()),
    path("fhir/MedicationStatement/", MedicationStatementView.as_view()),
]
