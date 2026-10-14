from __future__ import annotations

import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.models import F, Q
from django.http import HttpRequest
from django.utils import timezone

from backend.api.clinical_storage import ClinicalBundleStorageError
from backend.api.models import HandoverBundleRecord
from backend.api.views import _complete_transaction_side_effects, _resolve_persisted_handover_bundle


class Command(BaseCommand):
    help = 'Recover durable post-confirmation effects without resending the clinical transaction.'

    def add_arguments(self, parser):
        parser.add_argument('--continuous', action='store_true')
        parser.add_argument('--interval', type=float, default=30)
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--max-cycles', type=int, default=None)

    def handle(self, *args, **options):
        cycles = 0
        while True:
            close_old_connections()
            now = timezone.now()
            due = HandoverBundleRecord.objects.filter(
                status=HandoverBundleRecord.STATUS_SUCCEEDED, effects_pending=True,
                bundle_json__isnull=False, expires_at__gt=now, effects_attempts__lt=8,
            ).filter(Q(effects_next_retry_at__isnull=True) | Q(effects_next_retry_at__lte=now))
            for record in due.order_by('created_at')[:max(1, options['limit'])]:
                try:
                    bundle = _resolve_persisted_handover_bundle(record)
                    request = HttpRequest()
                    request.META['HTTP_IDEMPOTENCY_KEY'] = record.request_id
                    request.META['HTTP_X_UNIT_ID'] = record.unit_id
                    _complete_transaction_side_effects(
                        request, record=record, bundle=bundle, user_id=record.accepted_actor_sub,
                        unit_id=record.unit_id, automatic=True,
                    )
                except ClinicalBundleStorageError:
                    HandoverBundleRecord.objects.filter(pk=record.pk).update(
                        effects_attempts=8, effects_last_error='retained_bundle_unavailable',
                    )
                except Exception:
                    HandoverBundleRecord.objects.filter(
                        pk=record.pk, effects_attempts=record.effects_attempts,
                    ).update(
                        effects_attempts=F('effects_attempts') + 1,
                        effects_next_retry_at=timezone.now() + timedelta(
                            seconds=min(30 * 2 ** record.effects_attempts, 3600),
                        ),
                        effects_last_error='recovery_error',
                    )
            cycles += 1
            close_old_connections()
            if not options['continuous'] or (options['max_cycles'] is not None and cycles >= options['max_cycles']):
                return
            time.sleep(max(options['interval'], 0))
