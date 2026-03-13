import type { HandoverSignature } from '../../types/handover';
import type {
  AttesterInput,
  CompositionAttester,
  CompositionInput,
  HandoverSignatures,
  Reference,
  Signature,
} from '../fhir-map';

export function mapAttestersImpl(inputs?: CompositionInput['attesters']): CompositionAttester[] | undefined {
  if (!inputs || inputs.length === 0) return undefined;
  return inputs.map((attester) => {
    const base: CompositionAttester = {
      mode: attester.mode,
    };
    if (attester.time) {
      base.time = attester.time;
    }
    if (attester.partyReference || attester.partyDisplay || attester.partyIdentifier) {
      const resolvedReference =
        attester.partyReference?.trim() ||
        (attester.partyIdentifier?.value
          ? `Practitioner/${encodeURIComponent(attester.partyIdentifier.value)}`
          : undefined);
      if (resolvedReference) {
        base.party = {
          reference: resolvedReference,
          display: attester.partyDisplay,
          identifier: attester.partyIdentifier,
        };
      }
    }
    return base;
  });
}

export function attestersFromSignaturesImpl(signatures?: HandoverSignatures): AttesterInput[] {
  if (!signatures) return [];

  const mapSingle = (signature?: HandoverSignature | null): AttesterInput | null => {
    if (!signature) return null;
    return {
      mode: 'professional',
      time: signature.signedAt,
      partyDisplay: signature.fullName,
      partyIdentifier: { system: 'urn:handover:user-id', value: signature.userId },
    };
  };

  return [mapSingle(signatures.outgoing), mapSingle(signatures.incoming)].filter(
    (value): value is AttesterInput => value != null,
  );
}

export function buildSignatureResourceImpl(signature?: HandoverSignature | null): Signature | undefined {
  if (!signature?.imageBase64) return undefined;

  const who: Reference = {
    reference: `Practitioner/${encodeURIComponent(signature.userId)}`,
    identifier: { system: 'urn:handover:user-id', value: signature.userId },
    display: signature.fullName,
    type: 'Practitioner',
  };

  const onBehalfOf: Reference | undefined = signature.unitId
    ? {
        reference: `Organization/${encodeURIComponent(signature.unitId)}`,
        identifier: { system: 'urn:handover:unit-id', value: signature.unitId },
        display: signature.unitId,
        type: 'Organization',
      }
    : undefined;

  return {
    type: [{ system: 'urn:handover:signature-type', code: 'signature', display: 'Signature' }],
    when: signature.signedAt,
    who,
    onBehalfOf,
    sigFormat: 'image/png',
    data: signature.imageBase64,
  };
}
