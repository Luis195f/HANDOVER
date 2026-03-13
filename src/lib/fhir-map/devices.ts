import type { DeviceItem } from '../../types/handover';
import type {
  BuildOptions,
  Device,
  DeviceUseStatement,
  OxygenValues,
  Procedure,
  Reference,
} from '../fhir-map';
import { SNOMED, TERMINOLOGY_SYSTEMS } from '../codes';

export type DevicesMapperDependencies = {
  resolveOptions: (options?: BuildOptions) => { now: () => string } & BuildOptions;
  patientReference: (patientId: string) => Reference;
  encounterReference: (encounterId?: string) => Reference | undefined;
  fhirId: (prefix: string, value: string) => string;
  oxygenTherapySchema: {
    parse: (values: NonNullable<OxygenValues['oxygenTherapy']>) => NonNullable<OxygenValues['oxygenTherapy']>;
  };
};

const warnDevicesItemSkipped = (payload: {
  code: 'HANDOVER_DEVICES_ITEM_SKIPPED';
  reason: 'missing_name' | 'invalid_shape';
  item?: unknown;
}) => {
  void payload;
};

export function mapDeviceUseImpl(
  deps: DevicesMapperDependencies,
  values: OxygenValues,
  options?: BuildOptions,
): Array<Procedure | DeviceUseStatement | Device> {
  const optionsMerged = deps.resolveOptions(options);
  if (!values.oxygenTherapy) return [];
  const parsed = deps.oxygenTherapySchema.parse(values.oxygenTherapy);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);

  const start = parsed.start ?? optionsMerged.now();
  const procedure: Procedure = {
    resourceType: 'Procedure',
    status: parsed.status,
    code: {
      coding: [
        {
          system: TERMINOLOGY_SYSTEMS.SNOMED,
          code: SNOMED.oxygenTherapy,
          display: 'Administration of oxygen therapy',
        },
      ],
      text: 'Oxygen therapy',
    },
    subject,
    encounter,
  };

  if (parsed.end) {
    procedure.performedPeriod = { start, end: parsed.end };
  } else {
    procedure.performedDateTime = start;
  }

  if (parsed.reason) {
    procedure.reasonCode = [
      {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.SNOMED,
            code: parsed.reason,
          },
        ],
        text: parsed.reason,
      },
    ];
  }

  if (parsed.bodySite) {
    procedure.bodySite = [
      {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.SNOMED,
            code: parsed.bodySite,
            display: parsed.bodySite,
          },
        ],
        text: parsed.bodySite,
      },
    ];
  }

  if (parsed.note) {
    procedure.note = [{ text: parsed.note }];
  }

  const resources: Array<Procedure | DeviceUseStatement | Device> = [procedure];

  if (parsed.deviceDisplay || parsed.deviceId || parsed.device) {
    const deviceDisplay = parsed.deviceDisplay ?? parsed.device ?? 'Oxygen delivery device';
    const deviceId = parsed.deviceId ?? deps.fhirId('device-', `${values.patientId}|${deviceDisplay}`);
    resources.push({
      resourceType: 'Device',
      id: deviceId,
      status: 'active',
      deviceName: [{ name: deviceDisplay, type: 'user-friendly' }],
      patient: subject,
    });
    resources.push({
      resourceType: 'DeviceUseStatement',
      status: parsed.end ? 'completed' : 'active',
      subject,
      encounter,
      device: {
        reference: `Device/${deviceId}`,
        display: deviceDisplay,
      },
      timingPeriod: parsed.end ? { start, end: parsed.end } : { start },
    });
  }

  return resources;
}

export function mapDevicesImpl(
  deps: DevicesMapperDependencies,
  values: { patientId: string; encounterId?: string; devices?: Array<DeviceItem | unknown> },
  options?: BuildOptions,
): Array<Device | DeviceUseStatement> {
  const devices = Array.isArray(values.devices) ? values.devices : [];
  if (devices.length === 0) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const context = deps.encounterReference(values.encounterId);
  const timestamp = optionsMerged.now();

  return devices.flatMap((device, index) => {
    if (!device || typeof device !== 'object') {
      warnDevicesItemSkipped({
        code: 'HANDOVER_DEVICES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        item: device,
      });
      return [];
    }

    const nameRaw = (device as DeviceItem).name;
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) {
      warnDevicesItemSkipped({
        code: 'HANDOVER_DEVICES_ITEM_SKIPPED',
        reason: 'missing_name',
        item: device,
      });
      return [];
    }

    const isActive = (device as DeviceItem).active === true;
    const baseKey = `${values.patientId}|${values.encounterId ?? ''}|${name}|${index}`;
    const deviceId = deps.fhirId('device-', baseKey);
    const deviceUseId = deps.fhirId('dus-', `${baseKey}|${isActive ? 'active' : 'inactive'}`);

    const deviceResource: Device = {
      resourceType: 'Device',
      id: deviceId,
      status: isActive ? 'active' : 'inactive',
      deviceName: [{ name, type: 'user-friendly' }],
      patient: subject,
    };

    const deviceUseStatement: DeviceUseStatement = {
      resourceType: 'DeviceUseStatement',
      id: deviceUseId,
      status: isActive ? 'active' : 'completed',
      subject,
      context,
      device: { reference: `Device/${deviceId}`, display: name },
      timingPeriod: isActive ? { start: timestamp } : { start: timestamp, end: timestamp },
    };

    return [deviceResource, deviceUseStatement];
  });
}


