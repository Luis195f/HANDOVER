import logging
from django.test import TestCase, override_settings
from django.urls import path, reverse
from rest_framework.test import APIClient
from rest_framework.views import APIView

from backend.logging import RemovePersonalDataFilter


class BoomView(APIView):
    def get(self, _request):
        raise RuntimeError("boom")


urlpatterns = [
    path("api/boom", BoomView.as_view()),
]


class RemovePersonalDataFilterTests(TestCase):
    def test_sanitizes_message_and_extras(self):
        record = logging.LogRecord(
            name="handover",
            level=logging.ERROR,
            pathname=__file__,
            lineno=10,
            msg="Patient/abc-123 fullName: 'Jane Doe' user_id=99",
            args=(),
            exc_info=None,
            func=None,
            sinfo=None,
        )
        record.user_id = "u-123"
        filt = RemovePersonalDataFilter()

        allowed = filt.filter(record)

        self.assertTrue(allowed)
        self.assertNotIn("Jane Doe", record.msg)
        self.assertIn("Patient/****", record.msg)
        self.assertEqual(record.user_id, "****")


class ErrorLogEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_accepts_anonymous_post(self):
        with self.assertLogs("handover", level="ERROR") as captured:
            res = self.client.post(
                reverse("error-log"),
                {"message": "Oops Patient/xx", "stack": "trace fullName: 'Jane'"},
                format="json",
            )

        self.assertEqual(res.status_code, 201)
        rendered = "\n".join(captured.output)
        self.assertIn("MobileError", rendered)
        self.assertIn("Patient/****", rendered)
        self.assertNotIn("Jane", rendered)


@override_settings(ROOT_URLCONF=__name__)
class CustomExceptionHandlerTests(TestCase):
    def test_logs_and_masks_exception(self):
        client = APIClient()

        with self.assertLogs("handover", level="ERROR") as captured:
            res = client.get("/api/boom")

        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"detail": "Server error"})
        self.assertTrue(any("Unhandled API exception" in msg for msg in captured.output))
