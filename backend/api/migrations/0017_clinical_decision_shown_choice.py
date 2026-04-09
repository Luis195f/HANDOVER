from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0016_rotate_client_audit_patient_keys_v2"),
    ]

    operations = [
        migrations.AlterField(
            model_name="clinicaldecisionevent",
            name="decision",
            field=models.CharField(
                choices=[
                    ("shown", "Shown"),
                    ("accepted", "Accepted"),
                    ("applied", "Applied"),
                    ("rejected", "Rejected"),
                    ("dismissed", "Dismissed"),
                ],
                db_index=True,
                max_length=16,
            ),
        ),
    ]
