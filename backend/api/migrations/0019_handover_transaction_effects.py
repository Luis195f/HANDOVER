from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0018_handover_transaction_intent')]

    operations = [
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_pending',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_completed',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord', name='effects_claimed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
