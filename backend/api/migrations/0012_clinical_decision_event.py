from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_icea_bridge_request"),
    ]

    operations = [
        migrations.CreateModel(
            name="ClinicalDecisionEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("decision_id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("handover_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("patient_id", models.CharField(db_index=True, max_length=255)),
                ("unit_id", models.CharField(db_index=True, max_length=255)),
                ("actor_id", models.CharField(db_index=True, max_length=255)),
                ("actor_role", models.CharField(blank=True, max_length=64)),
                ("suggestion_source", models.CharField(db_index=True, max_length=64)),
                ("suggestion_version", models.CharField(blank=True, max_length=64)),
                (
                    "decision",
                    models.CharField(
                        choices=[
                            ("accepted", "Accepted"),
                            ("applied", "Applied"),
                            ("rejected", "Rejected"),
                            ("dismissed", "Dismissed"),
                        ],
                        db_index=True,
                        max_length=16,
                    ),
                ),
                ("reason_code", models.CharField(blank=True, max_length=64)),
                ("note", models.CharField(blank=True, max_length=240)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["unit_id", "created_at"], name="idx_clin_dec_unit_created"),
                    models.Index(fields=["patient_id", "created_at"], name="idx_clin_dec_patient_created"),
                    models.Index(fields=["suggestion_source", "created_at"], name="idx_clin_dec_source_created"),
                ],
            },
        ),
    ]
