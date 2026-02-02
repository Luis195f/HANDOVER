import uuid


class AuditRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.META.get("HTTP_X_REQUEST_ID")
        if not request_id:
            request_id = str(uuid.uuid4())

        request.audit_request_id = request_id
        request.audit_client_ip = self._get_client_ip(request)
        request.audit_user_agent = request.META.get("HTTP_USER_AGENT", "")

        response = self.get_response(request)
        response["X-Request-ID"] = request_id
        return response

    @staticmethod
    def _get_client_ip(request):
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")
