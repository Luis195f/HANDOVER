from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_clinical_decision_event"),
    ]

    operations = [
        migrations.AddField(
            model_name="iceabridgerequest",
            name="next_retry_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddIndex(
            model_name="iceabridgerequest",
            index=models.Index(fields=["status", "next_retry_at"], name="idx_icea_bridge_retry"),
        ),
    ]
