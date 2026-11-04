import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0020_handover_transaction_effects_recovery')]

    operations = [
        migrations.CreateModel(
            name='ExceptionHandoverShift',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('unit_id', models.CharField(db_index=True, max_length=64)),
                ('period_start', models.DateTimeField()),
                ('period_end', models.DateTimeField()),
                ('description', models.CharField(max_length=160)),
                ('creator_sub', models.CharField(max_length=255)),
                ('creation_key', models.UUIDField(unique=True)),
                ('creation_hash', models.CharField(max_length=64)),
                ('revision', models.PositiveIntegerField(default=0)),
                ('state_json', models.JSONField()),
                ('encryption_metadata', models.JSONField()),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
    ]
