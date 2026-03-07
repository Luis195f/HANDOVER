from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from backend.api.icea import deliver_icea_outbound_event, load_icea_webhook_settings
from backend.api.models import IceaOutboundEvent


class Command(BaseCommand):
    help = "Flush pending ICEA webhook outbox events"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        config = load_icea_webhook_settings()
        if not config.enabled:
            self.stdout.write(self.style.WARNING("ICEA webhook disabled; nothing to flush."))
            return
        if not config.configured:
            self.stdout.write(self.style.WARNING("ICEA webhook not fully configured; nothing to flush."))
            return

        now = timezone.now()
        limit = max(int(options.get("limit") or 100), 1)
        force = bool(options.get("force"))

        queryset = IceaOutboundEvent.objects.filter(
            status=IceaOutboundEvent.STATUS_PENDING,
            attempts__lt=config.retry_max,
        )
        if not force:
            queryset = queryset.filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))

        processed = 0
        delivered = 0
        failed = 0
        for event_id in queryset.order_by("created_at").values_list("id", flat=True)[:limit]:
            result = deliver_icea_outbound_event(event_id, force=force)
            processed += 1
            if result.delivered:
                delivered += 1
            elif result.status in {IceaOutboundEvent.STATUS_PENDING, IceaOutboundEvent.STATUS_ERROR}:
                failed += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Processed {processed} ICEA outbox event(s); delivered={delivered}, remaining_failures={failed}."
            )
        )
