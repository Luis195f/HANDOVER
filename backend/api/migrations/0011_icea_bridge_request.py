from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_icea_pipeline_snapshot_and_event'),
    ]

    operations = [
        migrations.CreateModel(
            name='IceaBridgeRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bridge_request_id', models.CharField(max_length=255, unique=True)),
                ('request_id', models.CharField(db_index=True, max_length=255)),
                ('bundle_id', models.CharField(db_index=True, max_length=255)),
                ('patient_id', models.CharField(db_index=True, max_length=255)),
                ('unit_id', models.CharField(db_index=True, max_length=255)),
                ('encounter_id', models.CharField(blank=True, db_index=True, max_length=255)),
                ('composition_id', models.CharField(blank=True, max_length=255)),
                ('episode_id', models.CharField(blank=True, db_index=True, max_length=255)),
                ('shift', models.CharField(blank=True, db_index=True, max_length=64)),
                (
                    'scoring_mode',
                    models.CharField(
                        choices=[
                            ('immediate_provisional', 'Immediate / provisional'),
                            ('enriched_followup', 'Enriched / follow-up'),
                        ],
                        db_index=True,
                        default='immediate_provisional',
                        max_length=32,
                    ),
                ),
                ('idempotency_key', models.CharField(db_index=True, max_length=255)),
                ('payload_hash', models.CharField(db_index=True, max_length=64)),
                ('payload_json', models.JSONField()),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('queued', 'Queued'),
                            ('sent', 'Sent'),
                            ('accepted', 'Accepted'),
                            ('pending', 'Pending'),
                            ('scored', 'Scored'),
                            ('failed', 'Failed'),
                            ('stale', 'Stale'),
                        ],
                        db_index=True,
                        default='queued',
                        max_length=24,
                    ),
                ),
                ('provisional', models.BooleanField(default=True)),
                ('insufficient_evidence', models.BooleanField(default=False)),
                ('contract_version', models.CharField(blank=True, max_length=64)),
                ('formula_version', models.CharField(blank=True, max_length=64)),
                ('score_summary_json', models.JSONField(blank=True, null=True)),
                ('warnings_json', models.JSONField(blank=True, default=list)),
                ('remote_refs_json', models.JSONField(blank=True, null=True)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('last_error', models.TextField(blank=True)),
                ('last_http_status', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('received_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True, db_index=True)),
            ],
            options={
                'ordering': ['-updated_at'],
                'indexes': [
                    models.Index(fields=['unit_id', 'updated_at'], name='idx_icea_bridge_unit_upd'),
                    models.Index(fields=['bundle_id', 'updated_at'], name='idx_icea_bridge_bundle_upd'),
                    models.Index(fields=['status', 'scoring_mode'], name='idx_icea_bridge_status_mode'),
                ],
            },
        ),
    ]
