from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from backend.api.models import (
    HandoverBundleRecord,
    IceaBridgeRequest,
    IceaOutboundEvent,
    IceaPipelineEvent,
    IceaPipelineSnapshot,
)


class Command(BaseCommand):
    help = "Prune expired clinical bundles and aged ICEA technical artifacts."

    def add_arguments(self, parser):
        parser.add_argument("--bundle-days", type=int, default=settings.HANDOVER_BUNDLE_RETENTION_DAYS)
        parser.add_argument("--technical-days", type=int, default=settings.HANDOVER_TECHNICAL_RETENTION_DAYS)

    def handle(self, *args, **options):
        bundle_days = max(options.get("bundle_days") or settings.HANDOVER_BUNDLE_RETENTION_DAYS, 1)
        technical_days = max(options.get("technical_days") or settings.HANDOVER_TECHNICAL_RETENTION_DAYS, 1)
        now = timezone.now()
        bundle_cutoff = now - timedelta(days=bundle_days)
        technical_cutoff = now - timedelta(days=technical_days)

        expired_bundles, _ = HandoverBundleRecord.objects.filter(expires_at__lte=now).delete()
        legacy_bundles, _ = HandoverBundleRecord.objects.filter(expires_at__isnull=True, created_at__lt=bundle_cutoff).delete()
        outbound_deleted, _ = IceaOutboundEvent.objects.filter(
            created_at__lt=technical_cutoff,
            status__in=[IceaOutboundEvent.STATUS_DELIVERED, IceaOutboundEvent.STATUS_FAILED],
        ).delete()
        bridge_deleted, _ = IceaBridgeRequest.objects.filter(
            updated_at__lt=technical_cutoff,
            status__in=[IceaBridgeRequest.STATUS_SCORED, IceaBridgeRequest.STATUS_FAILED, IceaBridgeRequest.STATUS_STALE],
        ).delete()
        snapshot_deleted, _ = IceaPipelineSnapshot.objects.filter(
            updated_at__lt=technical_cutoff,
            visible_status__in=[
                IceaPipelineSnapshot.STATUS_ACCEPTED,
                IceaPipelineSnapshot.STATUS_DELIVERED,
                IceaPipelineSnapshot.STATUS_SUCCEEDED,
                IceaPipelineSnapshot.STATUS_FAILED,
                IceaPipelineSnapshot.STATUS_EMPTY,
                IceaPipelineSnapshot.STATUS_NOT_CONFIGURED,
            ],
        ).delete()
        event_deleted, _ = IceaPipelineEvent.objects.filter(created_at__lt=technical_cutoff).delete()

        self.stdout.write(
            self.style.SUCCESS(
                "Pruned sensitive records: "
                f"handover_bundles={expired_bundles + legacy_bundles}, "
                f"icea_outbound_events={outbound_deleted}, "
                f"icea_bridge_requests={bridge_deleted}, "
                f"icea_pipeline_snapshots={snapshot_deleted}, "
                f"icea_pipeline_events={event_deleted}"
            )
        )
