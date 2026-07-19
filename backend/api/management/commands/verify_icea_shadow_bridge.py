import json

from django.core.management.base import BaseCommand

from backend.api.icea_shadow_verification import (
    DEFAULT_REQUEST_ID,
    verify_synthetic_icea_shadow_bridge,
)


class Command(BaseCommand):
    help = "Verify the HANDOVER -> ICEA shadow bridge with the fixed synthetic FHIR fixture"

    def add_arguments(self, parser):
        parser.add_argument("--request-id", default=DEFAULT_REQUEST_ID)
        parser.add_argument(
            "--allow-remote-test-endpoint",
            action="store_true",
            help="Explicitly confirm that a configured non-local HTTPS endpoint is a test ICEA instance.",
        )
        parser.add_argument("--compact", action="store_true")

    def handle(self, *args, **options):
        result = verify_synthetic_icea_shadow_bridge(
            request_id=str(options.get("request_id") or DEFAULT_REQUEST_ID).strip() or DEFAULT_REQUEST_ID,
            allow_remote_test_endpoint=bool(options.get("allow_remote_test_endpoint")),
        )
        indent = None if options.get("compact") else 2
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=indent, sort_keys=True))
