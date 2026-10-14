from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0017_clinical_decision_shown_choice')]

    operations = [
        migrations.AlterField(
            model_name='handoverbundlerecord',
            name='bundle_json',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='status',
            field=models.CharField(db_index=True, default='succeeded', max_length=16),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='payload_hash',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='patient_scope_hash',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='unit_scope_hash',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='response_json',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='handoverbundlerecord',
            name='response_status',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
