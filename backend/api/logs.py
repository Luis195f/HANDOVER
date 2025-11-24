import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger("handover")


class ErrorLogView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_scope = "error_log"

    def post(self, request):
        data = request.data or {}
        message = (data.get("message") or "")[:1000]
        stack = (data.get("stack") or "")[:5000]
        logger.error("MobileError: %s\nStack: %s", message, stack)
        return Response({"status": "logged"}, status=status.HTTP_201_CREATED)
