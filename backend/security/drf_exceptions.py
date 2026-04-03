from __future__ import annotations

from typing import Any

from rest_framework.views import exception_handler


def handover_exception_handler(exc: Exception, context: dict[str, Any]):
    response = exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(data, dict) and "code" not in data and "detail" in data:
        if hasattr(exc, "get_codes"):
            codes = exc.get_codes()
            if isinstance(codes, str) and codes:
                data["code"] = codes

    return response
