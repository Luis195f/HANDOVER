from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_harden_icea_outbound_event_contract"),
    ]

    operations = [
        migrations.CreateModel(
            name="IceaPipelineSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("request_id", models.CharField(max_length=255, unique=True)),
                ("bundle_id", models.CharField(db_index=True, max_length=255)),
                ("patient_id", models.CharField(db_index=True, max_length=255)),
                ("unit_id", models.CharField(db_index=True, max_length=255)),
                (
                    "visible_status",
                    models.CharField(
                        choices=[
                            ("accepted", "Accepted by HANDOVER"),
                            ("queued", "Queued"),
                            ("running", "Running"),
                            ("retry", "Retry scheduled"),
                            ("delivered", "Delivered to ICEA"),
                            ("succeeded", "Succeeded"),
                            ("failed", "Failed"),
                            ("empty", "Empty"),
                            ("not-configured", "Not configured"),
                        ],
                        db_index=True,
                        default="accepted",
                        max_length=32,
                    ),
                ),
                ("last_stage", models.CharField(default="handover", max_length=64)),
                ("stage_statuses", models.JSONField(blank=True, default=dict)),
                ("remote_refs", models.JSONField(blank=True, null=True)),
                ("dashboard_summary_json", models.JSONField(blank=True, null=True)),
                ("causal_report_json", models.JSONField(blank=True, null=True)),
                ("last_error", models.TextField(blank=True)),
                ("last_http_status", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True, db_index=True)),
            ],
            options={
                "ordering": ["-updated_at"],
                "indexes": [
                    models.Index(fields=["unit_id", "updated_at"], name="idx_icea_snapshot_unit_updated"),
                    models.Index(fields=["patient_id", "updated_at"], name="idx_icea_snapshot_patient_updated"),
                    models.Index(fields=["bundle_id", "updated_at"], name="idx_icea_snapshot_bundle_updated"),
                ],
            },
        ),
        migrations.CreateModel(
            name="IceaPipelineEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("request_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("bundle_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("patient_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("unit_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("stage", models.CharField(db_index=True, max_length=64)),
                ("action", models.CharField(blank=True, max_length=64)),
                ("status", models.CharField(db_index=True, max_length=32)),
                ("source", models.CharField(blank=True, max_length=64)),
                ("actor_sub", models.CharField(blank=True, max_length=255)),
                ("detail", models.CharField(blank=True, max_length=255)),
                ("http_status", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("payload_json", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "snapshot",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="events",
                        to="api.iceapipelinesnapshot",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["unit_id", "created_at"], name="idx_icea_event_unit_created"),
                    models.Index(fields=["stage", "created_at"], name="idx_icea_event_stage_created"),
                ],
            },
        ),
    ]
