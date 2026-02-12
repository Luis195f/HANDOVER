from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0002_audit_event"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="AuditEvent",
            new_name="ClientAuditEvent",
        ),
        migrations.AlterModelTable(
            name="clientauditevent",
            table="api_auditevent",
        ),
    ]
