import ipaddress
import os
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
        try:
            peer = ipaddress.ip_address(request.META.get("REMOTE_ADDR", ""))
        except ValueError:
            return ""
        remote = str(peer)
        configured = os.getenv("AUDIT_TRUSTED_PROXY_CIDRS", "")
        try:
            trusted = [ipaddress.ip_network(value.strip(), strict=False)
                       for value in configured.split(",") if value.strip()]
        except ValueError:
            return remote
        if not any(peer in network for network in trusted):
            return remote
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if not forwarded_for:
            return remote
        hops = forwarded_for.split(",")
        if len(hops) > 32:
            return remote
        try:
            addresses = [ipaddress.ip_address(hop.strip()) for hop in hops]
        except ValueError:
            return remote
        # Peel trusted proxies from the right. A client-controlled earlier value
        # cannot displace the first untrusted hop nearest the trusted chain.
        for address in reversed(addresses):
            if not any(peer in network for network in trusted):
                break
            peer = address
        return str(peer)
