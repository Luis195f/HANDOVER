from django.db import migrations, models


def backfill_icea_outbound_event_contract(apps, schema_editor):
    IceaOutboundEvent = apps.get_model("api", "IceaOutboundEvent")
    status_map = {
        "pending": "queued",
        "sent": "delivered",
        "error": "failed",
    }
    for event in IceaOutboundEvent.objects.all().iterator():
        event.idempotency_key = event.request_id
        event.status = status_map.get(event.status, event.status)
        event.save(update_fields=["idempotency_key", "status"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0008_handoverbundlerecord"),
    ]

    operations = [
        migrations.RenameField(
            model_name="iceaoutboundevent",
            old_name="sent_at",
            new_name="delivered_at",
        ),
        migrations.AddField(
            model_name="iceaoutboundevent",
            name="idempotency_key",
            field=models.CharField(db_index=True, default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="iceaoutboundevent",
            name="last_http_status",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="iceaoutboundevent",
            name="status",
            field=models.CharField(
                choices=[
                    ("queued", "Queued"),
                    ("retry", "Retry scheduled"),
                    ("delivered", "Delivered"),
                    ("failed", "Failed"),
                ],
                db_index=True,
                default="queued",
                max_length=24,
            ),
        ),
        migrations.RunPython(backfill_icea_outbound_event_contract, migrations.RunPython.noop),
    ]
