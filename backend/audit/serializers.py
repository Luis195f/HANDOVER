from typing import Any, Dict
import re

from rest_framework import serializers


FORBIDDEN_FIELDS = {"payload", "patient", "sbar", "note", "text"}
ALLOWED_FIELDS = {
    "eventType",
    "timestamp",
    "action",
    "status",
    "httpStatus",
    "resourceType",
    "resourceId",
    "payloadHash",
    "payloadSize",
    "requestId",
    "client",
}
ALLOWED_CLIENT_FIELDS = {"deviceId", "appVersion"}


class ClientInfoSerializer(serializers.Serializer):
    deviceId = serializers.CharField(required=False, allow_blank=True, max_length=255)
    appVersion = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AuditEventIngestSerializer(serializers.Serializer):
    eventType = serializers.CharField()
    timestamp = serializers.DateTimeField(required=False)
    action = serializers.CharField()
    status = serializers.CharField()
    httpStatus = serializers.IntegerField(required=False, allow_null=True)
    resourceType = serializers.CharField(required=False, allow_blank=True)
    resourceId = serializers.CharField(required=False, allow_blank=True)
    payloadHash = serializers.CharField(required=False, allow_blank=True)
    payloadSize = serializers.IntegerField(required=False, allow_null=True)
    requestId = serializers.CharField(required=False, allow_blank=True)
    client = ClientInfoSerializer(required=False)

    _pattern = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

    def validate_eventType(self, value: str) -> str:
        if not self._pattern.match(value):
            raise serializers.ValidationError("Invalid eventType")
        return value

    def validate_action(self, value: str) -> str:
        if not self._pattern.match(value):
            raise serializers.ValidationError("Invalid action")
        return value

    def validate_status(self, value: str) -> str:
        if not self._pattern.match(value):
            raise serializers.ValidationError("Invalid status")
        return value

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        self._validate_keys()
        return attrs

    def _validate_keys(self) -> None:
        initial = self.initial_data
        if not isinstance(initial, dict):
            raise serializers.ValidationError("Invalid payload")

        extra = set(initial.keys()) - ALLOWED_FIELDS
        if extra:
            raise serializers.ValidationError({"errors": ["Invalid fields in payload"]})

        forbidden_hits = [key for key in initial.keys() if key.lower() in FORBIDDEN_FIELDS]
        if forbidden_hits:
            raise serializers.ValidationError({"errors": ["Forbidden fields in payload"]})

        client = initial.get("client")
        if client is None:
            return

        if not isinstance(client, dict):
            raise serializers.ValidationError({"errors": ["Invalid client payload"]})

        client_extra = set(client.keys()) - ALLOWED_CLIENT_FIELDS
        if client_extra:
            raise serializers.ValidationError({"errors": ["Invalid client fields"]})

        client_forbidden = [key for key in client.keys() if key.lower() in FORBIDDEN_FIELDS]
        if client_forbidden:
            raise serializers.ValidationError({"errors": ["Forbidden fields in client"]})
