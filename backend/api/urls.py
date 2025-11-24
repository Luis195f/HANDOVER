from django.urls import path

from .views import BundleView, MedicationStatementView, PatientView

urlpatterns = [
    path("fhir/Patient/", PatientView.as_view()),
    path("fhir/transaction", BundleView.as_view()),
    path("fhir/MedicationStatement/", MedicationStatementView.as_view()),
]
