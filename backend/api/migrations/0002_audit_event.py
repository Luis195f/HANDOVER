from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("type", models.CharField(max_length=64)),
                ("user_id", models.CharField(max_length=255)),
                ("patient_id", models.CharField(blank=True, max_length=255)),
                ("unit_id", models.CharField(blank=True, max_length=255)),
                ("shift_code", models.CharField(blank=True, max_length=64)),
                ("meta", models.JSONField(blank=True, null=True)),
                ("occurred_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["-occurred_at"],
            },
        ),
    ]
