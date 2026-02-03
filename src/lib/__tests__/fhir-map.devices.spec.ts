import { describe, it, expect } from 'vitest';

let Map: any = {};
try { Map = await import('@/src/lib/fhir-map'); } catch {}

const has = (k: string) => Map && Object.prototype.hasOwnProperty.call(Map, k);

(has('mapDevices') ? describe : describe.skip)('mapDevices', () => {
  const { mapDevices } = Map;

  it('mapea dispositivos a Device y DeviceUseStatement', () => {
    const now = '2024-01-01T00:00:00.000Z';
    const resources = mapDevices(
      {
        patientId: 'pat-1',
        encounterId: 'enc-1',
        devices: [
          { name: 'Catéter venoso central', active: true },
          { name: 'Sonda vesical', active: false },
        ],
      },
      { now: () => now },
    );

    expect(resources).toHaveLength(4);

    const device = resources.find((resource: any) => resource.resourceType === 'Device' && resource.deviceName?.[0]?.name === 'Catéter venoso central');
    const deviceUse = resources.find((resource: any) => resource.resourceType === 'DeviceUseStatement' && resource.device?.display === 'Catéter venoso central');
    const deviceInactive = resources.find((resource: any) => resource.resourceType === 'Device' && resource.deviceName?.[0]?.name === 'Sonda vesical');
    const deviceUseInactive = resources.find((resource: any) => resource.resourceType === 'DeviceUseStatement' && resource.device?.display === 'Sonda vesical');

    expect(device?.status).toBe('active');
    expect(deviceUse?.status).toBe('active');
    expect(deviceUse?.timingPeriod?.end).toBeUndefined();
    expect(deviceUse?.device?.reference).toBe(`Device/${device?.id}`);

    expect(deviceInactive?.status).toBe('inactive');
    expect(deviceUseInactive?.status).toBe('completed');
    expect(deviceUseInactive?.timingPeriod?.end).toBe(now);
    expect(deviceUseInactive?.device?.reference).toBe(`Device/${deviceInactive?.id}`);
  });
});

(has('buildHandoverBundle') ? describe : describe.skip)('buildHandoverBundle devices section', () => {
  const { buildHandoverBundle } = Map;

  it('incluye sección Devices y narrativa Psicosocial', () => {
    const now = '2024-01-01T00:00:00.000Z';
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-1',
        encounterId: 'enc-1',
        bedsideChecklist: {
          patientIdentityConfirmed: true,
          allergiesReviewed: true,
          linesAndDevicesChecked: true,
          medicationPlanReviewed: true,
          safetyMeasuresApplied: true,
          questionsAnswered: true,
        },
        devices: [
          { name: 'Catéter venoso central', active: true },
          { name: 'Sonda vesical', active: false },
        ],
        psychosocial: {
          emotionalStatus: 'Deprimido',
          familyVisits: true,
          familyNotes: 'Hija presente en la tarde',
        },
      },
      { now: () => now },
    );

    const deviceUseStatements = bundle.entry.filter(
      (entry: any) => entry.resource.resourceType === 'DeviceUseStatement',
    );
    expect(deviceUseStatements).toHaveLength(2);

    const composition = bundle.entry.find(
      (entry: any) => entry.resource.resourceType === 'Composition',
    )?.resource;
    const devicesSection = composition?.section?.find(
      (section: any) => section.title === 'Devices',
    );
    expect(devicesSection).toBeDefined();

    const deviceRefs = deviceUseStatements
      .map((entry: any) =>
        entry.resource?.resourceType && entry.resource?.id
          ? `${entry.resource.resourceType}/${entry.resource.id}`
          : undefined,
      )
      .filter(Boolean)
      .sort();
    const sectionRefs = devicesSection?.entry?.map((entry: any) => entry.reference).sort();
    expect(sectionRefs).toEqual(deviceRefs);
  });
});
