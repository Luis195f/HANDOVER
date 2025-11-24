from django.urls import path

from .logs import ErrorLogView
from .views import MedicationStatementView, PatientView

urlpatterns = [
    path("fhir/Patient/", PatientView.as_view()),
    path("fhir/MedicationStatement/", MedicationStatementView.as_view()),
    path("logs/error/", ErrorLogView.as_view(), name="error-log"),
]
