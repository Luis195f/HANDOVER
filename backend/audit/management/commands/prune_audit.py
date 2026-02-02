from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from backend.audit.models import AuditEvent


class Command(BaseCommand):
    help = "Prune audit events older than configured retention period."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=settings.AUDIT_RETENTION_DAYS)

    def handle(self, *args, **options):
        days = options.get("days") or settings.AUDIT_RETENTION_DAYS
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = AuditEvent.objects.filter(timestamp__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"Pruned {deleted} audit events older than {days} days"))
