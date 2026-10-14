from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0019_handover_transaction_effects')]

    operations = [
        migrations.AddField(
            model_name='handoverbundlerecord', name='accepted_actor_sub',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_attempts',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_next_retry_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_last_error',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
