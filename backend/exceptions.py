import logging
from typing import Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger("handover")


def custom_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    logger.exception("Unhandled API exception", exc_info=exc, extra={"view": context.get("view")})

    response = exception_handler(exc, context)
    if response is not None:
        response.data = {"detail": response.data.get("detail", "Server error")}
        return response

    return Response({"detail": "Server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
