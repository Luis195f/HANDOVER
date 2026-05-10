from __future__ import annotations

import datetime
import re
from hashlib import sha256
from typing import Any

from django.utils import timezone

from backend.audit.utils import canonical_json

CONTRACT_VERSION = 'handover-icea-bridge-v1'
CONTEXTUAL_SIGNAL_CONTRACT_VERSION = 'handover-icea-context-v1'
MAPPER_VERSION = '2026-03-08'
SOURCE = 'HANDOVER'
DISPLAY_POLICY = 'shadow_aggregated_no_individual_score'
OBS_CODE_SYSTEM = 'urn:handover-pro:observation-codes'
OBS_ADMIN = 'administrative'
OBS_NOTES = 'handover-notes'
SBAR_SYSTEM = 'urn:handover-pro:sbar'
SBAR_CODE = 'sbar'
BEDSIDE_SYSTEM = 'urn:handover-pro:bedside-checklist'
BEDSIDE_CODE = 'bedside-checklist'
NOC_SYSTEM = 'urn:handover:terminology:NOC'
NANDA_SYSTEMS = {'urn:handover:terminology:NANDA-I', 'NANDA'}
LOINC_SYSTEM = 'http://loinc.org'
VITAL_CODES = {
    'hr': '8867-4',
    'rr': '9279-1',
    'tempC': '8310-5',
    'spo2': '59408-5',
    'sbp': '8480-6',
    'dbp': '8462-4',
    'glucoseMgDl': '2339-0',
    'glucoseMmolL': '15074-8',
    'avpu': '67775-7',
}
SCALE_CODES = {'painEva': '38208-5', 'braden': '38876-5', 'glasgow': '9267-6'}
OBS_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category'
OBS_CATEGORY_OUTCOME = 'outcome'
CONTEXT_SYSTEM = 'urn:handover-pro:context'
CONTEXT_CODE = 'clinical-context'
CONTEXT_COMPONENT_SYSTEM = 'urn:handover-pro:component'
PROFILE_COMPONENT_RE = re.compile(r'^(?P<label>.+?)\s*\((?P<identifier>[^()]+)\)\s*$')
SHIFT_RE = re.compile(r'^Shift:\s*(?P<start>.+?)\s*(?:→|->|>)\s*(?P<end>.+?)\s*$')
PENDING_HOSPITAL_SOURCE_FIELDS = [
    'adt_admission_source',
    'adt_length_of_stay_days',
    'nurse_to_patient_ratio',
    'mar_administration_count',
    'active_infusion_count',
    'recent_rapid_response_events',
    'multidisciplinary_consult_count',
    'discharge_destination',
    'functional_dependency_assessment',
    'care_transition_plan_status',
]


def build_icea_bridge_payload(
    bundle: dict[str, Any],
    *,
    request_id: str,
    scoring_mode: str,
    unit_id: str = '',
) -> dict[str, Any]:
    resources, full_urls = _index(bundle)
    observations = [resource for resource in resources if resource.get('resourceType') == 'Observation']
    conditions = [resource for resource in resources if resource.get('resourceType') == 'Condition']
    patient = _first(resources, 'Patient')
    encounter = _first(resources, 'Encounter')
    composition = _first(resources, 'Composition')

    bundle_id = _bundle_id(bundle) or request_id
    patient_id = _patient_id(resources, full_urls) or 'unknown'
    encounter_id = _id(encounter)
    composition_id = _id(composition)
    admin = _admin(observations)
    effective_unit_id = (unit_id or '').strip() or admin.get('unitId') or _unit_from_bundle(bundle, resources, full_urls) or 'unknown'
    window_start, window_end, invalid_shift_window = _shift_window(composition, encounter, admin)
    age_years = _age(
        patient.get('birthDate') if isinstance(patient, dict) else None,
        reference=_clinical_reference_datetime(
            bundle=bundle,
            composition=composition,
            encounter=encounter,
            window_start=window_start,
            window_end=window_end,
        ),
    )
    has_shift_window = bool(window_start and window_end)
    shift = admin.get('shiftType') or _infer_shift(window_start)
    diagnoses = _diagnoses(conditions)
    risk_flags = _risk_flags(conditions)
    vitals = _vitals(observations)
    scales = _scales(observations)
    outcomes = _outcomes(observations)
    checklist = _checklist(observations)
    closing_summary = _notes(observations)
    sbar = _sbar(observations)
    actors = _actors(bundle, composition, full_urls)
    clinical_context = _clinical_context(observations)

    intervention_count = sum(
        1
        for resource in resources
        if resource.get('resourceType') in {'MedicationStatement', 'Procedure', 'DeviceUseStatement'}
    ) + outcomes['documentedOutcomeCount']
    exam_count = sum(1 for observation in observations if _is_exam(observation))
    completeness_checks = {
        'patientContext': patient_id not in {'', 'unknown'},
        'unitContext': effective_unit_id not in {'', 'unknown'},
        'shiftWindow': has_shift_window,
        'clinicalSummary': bool(closing_summary),
        'sbar': bool(sbar['present']),
        'bedsideChecklist': checklist['expectedCount'] > 0,
        'diagnoses': len(diagnoses) > 0,
        'vitals': any(vitals.get(key) is not None for key in ('hr', 'rr', 'tempC', 'spo2', 'sbp', 'dbp')),
        'documentedInterventions': intervention_count > 0,
        'signedClosure': bool(actors['primaryNurseId']),
    }
    present = [name for name, ok in completeness_checks.items() if ok]
    missing = [name for name, ok in completeness_checks.items() if not ok]
    completeness_rate = round(len(present) / len(completeness_checks), 4)

    missingness_inputs = {
        'ageYears': age_years is not None,
        'diagnoses': len(diagnoses) > 0,
        'vitals': completeness_checks['vitals'],
        'clinicalSummary': bool(closing_summary),
        'sbar': bool(sbar['present']),
        'bedsideChecklist': checklist['completionRate'] is not None,
        'outcomes': outcomes['documentedOutcomeCount'] > 0,
        'shiftWindow': completeness_checks['shiftWindow'],
        'signedClosure': completeness_checks['signedClosure'],
    }
    missingness_rate = round(sum(1 for ok in missingness_inputs.values() if not ok) / len(missingness_inputs), 4)
    warnings: list[dict[str, str]] = []
    if missingness_rate >= 0.5:
        warnings.append({'code': 'insufficient_evidence', 'message': 'The payload is missing key inputs for a confident analytic score.'})
    if invalid_shift_window:
        warnings.append({'code': 'invalid_shift_window', 'message': 'Shift timing could not be parsed as ISO datetimes; HANDOVER falls back to episode or handover grain.'})
    if not completeness_checks['shiftWindow']:
        warnings.append({'code': 'missing_shift_window', 'message': 'Shift timing is incomplete; HANDOVER falls back to handover-level grain.'})
    if not completeness_checks['signedClosure']:
        warnings.append({'code': 'unsigned_handover', 'message': 'No signed handover actor was found in the current bundle.'})
    if _is_stale(window_end):
        warnings.append({'code': 'stale_data', 'message': 'The handover window closed more than 24 hours ago.'})

    signature_count = int(actors['signatureCount'] or 0)
    exposure_share = round(1.0 / signature_count, 4) if signature_count > 0 else None
    observed_contextual_fields = _build_observed_contextual_fields(
        clinical_context=clinical_context,
        case_mix={'ageYears': age_years, 'diagnoses': diagnoses, 'riskFlags': risk_flags},
        exposure={
            'documentedMedicationCount': sum(1 for resource in resources if resource.get('resourceType') == 'MedicationStatement'),
            'documentedProcedureCount': sum(1 for resource in resources if resource.get('resourceType') == 'Procedure'),
            'documentedDeviceUseCount': sum(1 for resource in resources if resource.get('resourceType') == 'DeviceUseStatement'),
            'documentedOutcomeCount': outcomes['documentedOutcomeCount'],
            'documentedExamCount': exam_count,
        },
        change_signals={
            'abnormalVitalCount': vitals['abnormalVitalCount'],
            'closingSummaryPresent': bool(closing_summary),
            'sbarPresent': sbar['present'],
        },
        quality={'shiftClosureDocumented': completeness_checks['shiftWindow'] and completeness_checks['signedClosure']},
        uncertainty={'missingnessRate': missingness_rate, 'supportLevel': round(1 - missingness_rate, 4)},
        severity_weight=_severity(vitals, scales, risk_flags),
    )
    derived_contextual_fields = _build_derived_contextual_fields(observed_contextual_fields)
    contextual_signal = _build_contextual_signal(
        clinical_context=clinical_context,
        observed_fields=observed_contextual_fields,
        derived_fields=derived_contextual_fields,
    )

    payload = {
        'contractVersion': CONTRACT_VERSION,
        'source': SOURCE,
        'scoringMode': scoring_mode,
        'provisional': scoring_mode == 'immediate_provisional',
        'identity': {
            'handoverId': bundle_id,
            'bundleId': bundle_id,
            'bundleIdentifier': _identifier(bundle.get('identifier')),
            'requestId': request_id,
            'patientId': patient_id,
            'episodeId': encounter_id or bundle_id,
            'encounterId': encounter_id,
            'compositionId': composition_id,
        },
        'context': {
            'grain': 'shift' if has_shift_window else 'episode' if encounter_id else 'handover',
            'timestamp': _safe((composition or {}).get('date')) or _ts(),
            'windowStart': window_start,
            'windowEnd': window_end,
            'unitId': effective_unit_id,
            'teamId': actors['teamId'],
            'primaryActorDocumented': bool(actors['primaryNurseId']),
            'documentedAuthorPresent': bool(actors['authorId']),
            'documentedCoSignerCount': len(actors['coSignerIds']),
            'documentedActorCount': signature_count,
            'shift': shift,
            'handoverLoad': {
                'census': admin.get('census'),
                'incomingStaffCount': admin.get('incomingStaffCount'),
                'outgoingStaffCount': admin.get('outgoingStaffCount'),
                'incidentCount': admin.get('incidentCount'),
            },
        },
        'caseMix': {
            'ageYears': age_years,
            'sex': _safe(patient.get('gender') if isinstance(patient, dict) else None),
            'diagnoses': diagnoses,
            'riskFlags': risk_flags,
            'baselineScores': {
                'braden': scales['braden'],
                'glasgow': scales['glasgow'],
                'painEva': scales['painEva'],
                'avpu': vitals['avpu'],
            },
        },
        'nursingExposure': {
            'documentedMedicationCount': sum(1 for resource in resources if resource.get('resourceType') == 'MedicationStatement'),
            'documentedProcedureCount': sum(1 for resource in resources if resource.get('resourceType') == 'Procedure'),
            'documentedDeviceUseCount': sum(1 for resource in resources if resource.get('resourceType') == 'DeviceUseStatement'),
            'documentedOutcomeCount': outcomes['documentedOutcomeCount'],
            'documentedExamCount': exam_count,
            'bedsideChecklistCompletionRate': checklist['completionRate'],
            'documentedChangeSignals': {
                'closingSummaryPresent': bool(closing_summary),
                'sbarPresent': sbar['present'],
                'outcomesWithCurrentValue': outcomes['outcomesWithCurrentValue'],
                'abnormalVitalCount': vitals['abnormalVitalCount'],
            },
            'severityWeight': _severity(vitals, scales, risk_flags),
            'exposureShare': exposure_share,
            'attribution': {
                'signatureCount': actors['signatureCount'],
                'documentedCoSignerCount': len(actors['coSignerIds']),
                'primaryActorDocumented': bool(actors['primaryNurseId']),
                'documentedAuthorPresent': bool(actors['authorId']),
                'staffIdentifiersRedacted': True,
            },
        },
        'qualitySignals': {
            'structuredCompletenessRate': completeness_rate,
            'criticalFieldsPresent': present,
            'criticalMissingFields': missing,
            'bedsideChecklistCompletionRate': checklist['completionRate'],
            'shiftClosureDocumented': completeness_checks['shiftWindow'] and completeness_checks['signedClosure'],
            'sbarComponentCount': sbar['componentCount'],
        },
        'uncertaintySignals': {
            'missingnessRate': missingness_rate,
            'supportLevel': round(1 - missingness_rate, 4),
            'payloadCompletenessClass': 'low' if missingness_rate >= 0.5 else 'medium' if missingness_rate >= 0.25 else 'high',
            'staleData': _is_stale(window_end),
            'insufficientEvidence': missingness_rate >= 0.5,
            'warnings': warnings,
        },
        'provenance': {
            'mapperVersion': MAPPER_VERSION,
            'generatedAt': _ts(),
            'bundleHash': sha256(canonical_json(bundle)).hexdigest(),
            'lineage': {
                'requestId': request_id,
                'bundleId': bundle_id,
                'patientId': patient_id,
                'encounterId': encounter_id,
                'compositionId': composition_id,
            },
        },
        'governance': {
            'displayPolicy': DISPLAY_POLICY,
            'staffIdentifiersRedacted': True,
            'individualScoreVisible': False,
            'causalSummaryVisible': False,
        },
        'contextualSignal': contextual_signal,
    }
    return _validate_icea_bridge_payload_contract(payload)


def compute_payload_hash(payload: dict[str, Any]) -> str:
    return sha256(canonical_json(payload)).hexdigest()


def _validate_icea_bridge_payload_contract(payload: dict[str, Any]) -> dict[str, Any]:
    required_top_level = (
        'contractVersion',
        'source',
        'scoringMode',
        'identity',
        'context',
        'caseMix',
        'nursingExposure',
        'qualitySignals',
        'uncertaintySignals',
        'provenance',
        'governance',
        'contextualSignal',
    )
    missing_top_level = [key for key in required_top_level if key not in payload]
    if missing_top_level:
        raise ValueError(f'Invalid ICEA bridge payload: missing top-level fields {missing_top_level}')
    if payload.get('contractVersion') != CONTRACT_VERSION:
        raise ValueError('Invalid ICEA bridge payload: unexpected contractVersion')

    identity = payload.get('identity')
    context = payload.get('context')
    provenance = payload.get('provenance')
    governance = payload.get('governance')
    contextual_signal = payload.get('contextualSignal')
    uncertainty = payload.get('uncertaintySignals')
    exposure = payload.get('nursingExposure')
    attribution = exposure.get('attribution') if isinstance(exposure, dict) else None

    if not isinstance(identity, dict) or not all(identity.get(key) for key in ('bundleId', 'requestId', 'patientId')):
        raise ValueError('Invalid ICEA bridge payload: identity linkage is incomplete')
    if not isinstance(context, dict) or not all(key in context for key in ('grain', 'timestamp', 'unitId', 'shift')):
        raise ValueError('Invalid ICEA bridge payload: context block is incomplete')
    if not isinstance(provenance, dict):
        raise ValueError('Invalid ICEA bridge payload: provenance block is missing')
    if not isinstance(provenance.get('lineage'), dict) or not provenance['lineage'].get('requestId'):
        raise ValueError('Invalid ICEA bridge payload: provenance lineage is incomplete')
    if not isinstance(governance, dict):
        raise ValueError('Invalid ICEA bridge payload: governance block is missing')
    if governance.get('displayPolicy') != DISPLAY_POLICY:
        raise ValueError('Invalid ICEA bridge payload: unexpected governance displayPolicy')
    if governance.get('staffIdentifiersRedacted') is not True:
        raise ValueError('Invalid ICEA bridge payload: governance must redact staff identifiers')
    if governance.get('individualScoreVisible') is not False or governance.get('causalSummaryVisible') is not False:
        raise ValueError('Invalid ICEA bridge payload: governance must suppress individual analytics display')
    if not isinstance(contextual_signal, dict) or contextual_signal.get('contract_version') != CONTEXTUAL_SIGNAL_CONTRACT_VERSION:
        raise ValueError('Invalid ICEA bridge payload: contextual signal contract is missing')
    warnings = uncertainty.get('warnings') if isinstance(uncertainty, dict) else None
    if warnings is not None and not isinstance(warnings, list):
        raise ValueError('Invalid ICEA bridge payload: uncertainty warnings must be a list')
    if isinstance(attribution, dict):
        if attribution.get('staffIdentifiersRedacted') is not True:
            raise ValueError('Invalid ICEA bridge payload: attribution must stay redacted')
        for forbidden_key in ('primaryNurseId', 'coSignerIds'):
            if forbidden_key in attribution:
                raise ValueError('Invalid ICEA bridge payload: nominal staff identifiers are not allowed in attribution')
    for forbidden_key in ('nurseId', 'coSignerIds', 'documentedAuthorId'):
        if isinstance(context, dict) and forbidden_key in context:
            raise ValueError('Invalid ICEA bridge payload: nominal staff identifiers are not allowed in context')
    return payload


def _index(bundle: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    resources: list[dict[str, Any]] = []
    full_urls: dict[str, dict[str, Any]] = {}
    for entry in bundle.get('entry') or []:
        if not isinstance(entry, dict):
            continue
        resource = entry.get('resource')
        if not isinstance(resource, dict):
            continue
        resources.append(resource)
        full_url = _safe(entry.get('fullUrl'))
        if full_url:
            full_urls[full_url] = resource
    return resources, full_urls


def _first(resources: list[dict[str, Any]], resource_type: str) -> dict[str, Any] | None:
    for resource in resources:
        if resource.get('resourceType') == resource_type:
            return resource
    return None


def _id(resource: Any) -> str | None:
    if isinstance(resource, dict):
        return _safe(resource.get('id'))
    return None


def _identifier(value: Any) -> str | None:
    if isinstance(value, dict):
        return _safe(value.get('value'))
    if isinstance(value, list):
        for item in value:
            resolved = _identifier(item)
            if resolved:
                return resolved
    return None


def _ref_id(reference: Any, full_urls: dict[str, dict[str, Any]]) -> str | None:
    if isinstance(reference, dict):
        return _identifier(reference.get('identifier')) or _ref_id(reference.get('reference'), full_urls)
    raw = _safe(reference)
    if not raw:
        return None
    if raw in full_urls:
        return _id(full_urls[raw])
    if '/' in raw:
        return raw.rsplit('/', 1)[-1].strip() or None
    return raw


def _bundle_id(bundle: dict[str, Any]) -> str | None:
    return _identifier(bundle.get('identifier')) or _safe(bundle.get('id'))


def _patient_id(resources: list[dict[str, Any]], full_urls: dict[str, dict[str, Any]]) -> str | None:
    patient = _first(resources, 'Patient')
    if patient:
        return _id(patient)
    composition = _first(resources, 'Composition')
    if composition:
        return _ref_id(composition.get('subject'), full_urls)
    return None


def _unit_from_bundle(bundle: dict[str, Any], resources: list[dict[str, Any]], full_urls: dict[str, dict[str, Any]]) -> str | None:
    for signature in bundle.get('signature') or []:
        if not isinstance(signature, dict):
            continue
        on_behalf = signature.get('onBehalfOf') or {}
        unit_id = _identifier(on_behalf.get('identifier')) or _ref_id(on_behalf.get('reference'), full_urls) or _safe(on_behalf.get('display'))
        if unit_id:
            return unit_id
    for resource in resources:
        for extension in resource.get('extension') or []:
            if not isinstance(extension, dict):
                continue
            url = _safe(extension.get('url'))
            if not url or not url.lower().endswith('/unit-id'):
                continue
            for key in ('valueString', 'valueCode', 'valueId'):
                value = _safe(extension.get(key))
                if value:
                    return value
    return None


def _shift_window(
    composition: dict[str, Any] | None,
    encounter: dict[str, Any] | None,
    admin: dict[str, Any],
) -> tuple[str | None, str | None, bool]:
    invalid_window = False
    for event in (composition or {}).get('event') or []:
        if not isinstance(event, dict):
            continue
        period = event.get('period') or {}
        start, end, invalid = _validated_window(period.get('start'), period.get('end'))
        if start and end:
            return start, end, False
        invalid_window = invalid_window or invalid
    period = (encounter or {}).get('period') or {}
    if isinstance(period, dict):
        start, end, invalid = _validated_window(period.get('start'), period.get('end'))
        if start and end:
            return start, end, False
        invalid_window = invalid_window or invalid
    start, end, invalid = _validated_window(admin.get('windowStart'), admin.get('windowEnd'))
    if start and end:
        return start, end, False
    invalid_window = invalid_window or invalid or bool(admin.get('windowParseError'))
    return None, None, invalid_window


def _parse_shift_line(line: str) -> tuple[str | None, str | None, bool]:
    if not line.startswith('Shift:'):
        return None, None, False
    match = SHIFT_RE.match(line)
    if not match:
        return None, None, True
    window_start, window_end, invalid = _validated_window(match.group('start'), match.group('end'))
    if window_start and window_end:
        return window_start, window_end, False
    return None, None, True


def _infer_shift(window_start: str | None) -> str | None:
    parsed = _dt(window_start)
    if parsed is None:
        return None
    if 6 <= parsed.hour < 14:
        return 'Mañana'
    if 14 <= parsed.hour < 22:
        return 'Tarde'
    return 'Noche'


def _admin(observations: list[dict[str, Any]]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for observation in observations:
        if not _has_code(observation, OBS_CODE_SYSTEM, OBS_ADMIN):
            continue
        value = _safe(observation.get('valueString'))
        if not value:
            break
        for raw_line in value.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith('Unit: '):
                payload['unitId'] = line.replace('Unit: ', '', 1).strip() or None
            elif line.startswith('Census: '):
                try:
                    payload['census'] = int(line.replace('Census: ', '', 1).strip())
                except ValueError:
                    payload['census'] = None
            elif line.startswith('Shift type: '):
                payload['shiftType'] = line.replace('Shift type: ', '', 1).strip() or None
            elif line.startswith('Incoming staff: '):
                payload['incomingStaffCount'] = len([item for item in line.replace('Incoming staff: ', '', 1).split(',') if item.strip() and item.strip() != 'N/D'])
            elif line.startswith('Outgoing staff: '):
                payload['outgoingStaffCount'] = len([item for item in line.replace('Outgoing staff: ', '', 1).split(',') if item.strip() and item.strip() != 'N/D'])
            elif line.startswith('Incidents: '):
                payload['incidentCount'] = len([item for item in line.replace('Incidents: ', '', 1).split(';') if item.strip()])
            elif line.startswith('Shift:'):
                window_start, window_end, invalid = _parse_shift_line(line)
                if window_start and window_end:
                    payload['windowStart'] = window_start
                    payload['windowEnd'] = window_end
                elif invalid:
                    payload['windowParseError'] = True
        break
    return payload


def _diagnoses(conditions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for condition in conditions:
        code = condition.get('code') or {}
        codings = code.get('coding') if isinstance(code, dict) else []
        coding = codings[0] if isinstance(codings, list) and codings else None
        system = _safe((coding or {}).get('system'))
        code_value = _safe((coding or {}).get('code'))
        display = _safe((coding or {}).get('display')) or _safe(code.get('text') if isinstance(code, dict) else None)
        if not (system or code_value or display):
            continue
        results.append(
            {
                'type': 'nursing' if system in NANDA_SYSTEMS else 'medical',
                'system': system,
                'code': code_value,
            }
        )
    return results


def _risk_flags(conditions: list[dict[str, Any]]) -> list[str]:
    results: list[str] = []
    for condition in conditions:
        categories = condition.get('category') or []
        if not isinstance(categories, list):
            continue
        risk_like = False
        for category in categories:
            codings = category.get('coding') if isinstance(category, dict) else []
            for coding in codings or []:
                display = _safe((coding or {}).get('display')) or ''
                if 'risk' in display.lower() or 'riesgo' in display.lower():
                    risk_like = True
                    break
            if risk_like:
                break
        if not risk_like:
            continue
        code = _code_value((condition.get('code') or {}) if isinstance(condition.get('code'), dict) else {})
        results.append(code or 'risk-condition')
    return results


def _vitals(observations: list[dict[str, Any]]) -> dict[str, Any]:
    values: dict[str, Any] = {key: None for key in VITAL_CODES}
    for observation in observations:
        for key, code in VITAL_CODES.items():
            if _has_code(observation, LOINC_SYSTEM, code):
                if key == 'avpu':
                    values[key] = _avpu(observation)
                else:
                    values[key] = _numeric(observation)
                break
    abnormal = 0
    if isinstance(values['hr'], (int, float)) and (values['hr'] < 40 or values['hr'] > 130):
        abnormal += 1
    if isinstance(values['rr'], (int, float)) and (values['rr'] < 8 or values['rr'] > 30):
        abnormal += 1
    if isinstance(values['spo2'], (int, float)) and values['spo2'] < 90:
        abnormal += 1
    if isinstance(values['sbp'], (int, float)) and values['sbp'] < 90:
        abnormal += 1
    if values['avpu'] in {'V', 'P', 'U', 'C'}:
        abnormal += 1
    values['abnormalVitalCount'] = abnormal
    return values


def _avpu(observation: dict[str, Any]) -> str | None:
    concept = observation.get('valueCodeableConcept') or {}
    codings = concept.get('coding') if isinstance(concept, dict) else []
    for coding in codings or []:
        code = _safe((coding or {}).get('code'))
        display = _safe((coding or {}).get('display'))
        if code in {'A', 'C', 'V', 'P', 'U'}:
            return code
        if display and display[:1].upper() in {'A', 'C', 'V', 'P', 'U'}:
            return display[:1].upper()
    return None


def _scales(observations: list[dict[str, Any]]) -> dict[str, Any]:
    values = {'painEva': None, 'braden': None, 'glasgow': None}
    for observation in observations:
        for key, code in SCALE_CODES.items():
            if _has_code(observation, LOINC_SYSTEM, code):
                values[key] = _numeric(observation)
                break
    return values


def _outcomes(observations: list[dict[str, Any]]) -> dict[str, int]:
    documented = 0
    current_values = 0
    for observation in observations:
        if not _is_outcome(observation):
            continue
        documented += 1
        for component in observation.get('component') or []:
            code = _code_value((component.get('code') or {}) if isinstance(component, dict) else {})
            if code == 'current':
                current_values += 1
                break
    return {'documentedOutcomeCount': documented, 'outcomesWithCurrentValue': current_values}


def _checklist(observations: list[dict[str, Any]]) -> dict[str, Any]:
    expected = 0
    completed = 0
    for observation in observations:
        if not _has_code(observation, BEDSIDE_SYSTEM, BEDSIDE_CODE):
            continue
        for component in observation.get('component') or []:
            if not isinstance(component, dict):
                continue
            expected += 1
            concept = component.get('valueCodeableConcept') or {}
            codings = concept.get('coding') if isinstance(concept, dict) else []
            if any(_safe((coding or {}).get('code')) == 'yes' for coding in codings or []):
                completed += 1
        break
    return {
        'expectedCount': expected,
        'completedCount': completed,
        'completionRate': round(completed / expected, 4) if expected else None,
    }


def _notes(observations: list[dict[str, Any]]) -> str | None:
    for observation in observations:
        if _has_code(observation, OBS_CODE_SYSTEM, OBS_NOTES):
            return _safe(observation.get('valueString'))
    return None


def _sbar(observations: list[dict[str, Any]]) -> dict[str, Any]:
    component_count = 0
    sections: list[str] = []
    for observation in observations:
        if not _has_code(observation, SBAR_SYSTEM, SBAR_CODE):
            continue
        for component in observation.get('component') or []:
            code = _code_value((component.get('code') or {}) if isinstance(component, dict) else {})
            if code:
                sections.append(code)
                component_count += 1
        break
    return {'present': component_count > 0, 'componentCount': component_count, 'sections': sections}


def _clinical_context(observations: list[dict[str, Any]]) -> dict[str, Any]:
    context = {
        'profileId': None,
        'overlayIds': [],
        'prioritySignals': [],
        'pendingCriticalTaskCount': 0,
    }
    for observation in observations:
        if not _has_code(observation, CONTEXT_SYSTEM, CONTEXT_CODE):
            continue
        for component in observation.get('component') or []:
            if not isinstance(component, dict):
                continue
            component_code = _component_code(component)
            if component_code == 'unit-profile':
                _label, identifier = _profile_value(component.get('valueString'))
                if identifier:
                    context['profileId'] = identifier
            elif component_code == 'specialty-overlay':
                _label, identifier = _profile_value(component.get('valueString'))
                if identifier and identifier not in context['overlayIds']:
                    context['overlayIds'].append(identifier)
            elif component_code == 'priority-signal':
                signal = _safe(component.get('valueString'))
                if signal:
                    context['prioritySignals'].append(signal)
            elif component_code == 'pending-critical-task-count':
                count = component.get('valueInteger')
                if isinstance(count, int) and count >= 0:
                    context['pendingCriticalTaskCount'] = count
        break
    return context


def _actors(bundle: dict[str, Any], composition: dict[str, Any] | None, full_urls: dict[str, dict[str, Any]]) -> dict[str, Any]:
    actor_ids: list[str] = []
    author_id = None
    team_id = None
    for author in (composition or {}).get('author') or []:
        author_id = _ref_id(author, full_urls) or author_id
        if author_id:
            actor_ids.append(author_id)
    for attester in (composition or {}).get('attester') or []:
        if not isinstance(attester, dict):
            continue
        party = attester.get('party') or {}
        actor_id = _ref_id(party, full_urls)
        if actor_id:
            actor_ids.append(actor_id)
        team_id = team_id or _identifier((attester.get('onBehalfOf') or {}).get('identifier'))
    for signature in bundle.get('signature') or []:
        if not isinstance(signature, dict):
            continue
        who = signature.get('who') or {}
        actor_id = _identifier(who.get('identifier')) or _ref_id(who.get('reference'), full_urls)
        if actor_id:
            actor_ids.append(actor_id)
        on_behalf = signature.get('onBehalfOf') or {}
        team_id = team_id or _identifier(on_behalf.get('identifier')) or _safe(on_behalf.get('display'))
    unique_ids: list[str] = []
    for actor_id in actor_ids:
        if actor_id and actor_id not in unique_ids:
            unique_ids.append(actor_id)
    return {
        'primaryNurseId': unique_ids[0] if unique_ids else None,
        'coSignerIds': unique_ids[1:],
        'authorId': author_id,
        'teamId': team_id,
        'signatureCount': len(unique_ids),
    }


def _build_observed_contextual_fields(
    *,
    clinical_context: dict[str, Any],
    case_mix: dict[str, Any],
    exposure: dict[str, Any],
    change_signals: dict[str, Any],
    quality: dict[str, Any],
    uncertainty: dict[str, Any],
    severity_weight: float | None,
) -> dict[str, dict[str, Any]]:
    diagnoses = case_mix.get('diagnoses') if isinstance(case_mix.get('diagnoses'), list) else []
    risk_flags = case_mix.get('riskFlags') if isinstance(case_mix.get('riskFlags'), list) else []
    return {
        'profile_id': {
            'value': clinical_context.get('profileId'),
            'source': 'bundle.clinical-context.unit-profile',
        },
        'overlay_ids': {
            'value': clinical_context.get('overlayIds') if isinstance(clinical_context.get('overlayIds'), list) else [],
            'source': 'bundle.clinical-context.specialty-overlay',
        },
        'priority_signal_labels': {
            'value': clinical_context.get('prioritySignals') if isinstance(clinical_context.get('prioritySignals'), list) else [],
            'source': 'bundle.clinical-context.priority-signal',
        },
        'pending_critical_task_count': {
            'value': _float_value(clinical_context.get('pendingCriticalTaskCount')),
            'source': 'bundle.clinical-context.pending-critical-task-count',
        },
        'age_years': {'value': _float_value(case_mix.get('ageYears')), 'source': 'caseMix.ageYears'},
        'diagnosis_count': {'value': float(len(diagnoses)), 'source': 'caseMix.diagnoses'},
        'risk_flag_count': {'value': float(len(risk_flags)), 'source': 'caseMix.riskFlags'},
        'documented_medication_count': {
            'value': _float_value(exposure.get('documentedMedicationCount')),
            'source': 'nursingExposure.documentedMedicationCount',
        },
        'documented_procedure_count': {
            'value': _float_value(exposure.get('documentedProcedureCount')),
            'source': 'nursingExposure.documentedProcedureCount',
        },
        'documented_device_use_count': {
            'value': _float_value(exposure.get('documentedDeviceUseCount')),
            'source': 'nursingExposure.documentedDeviceUseCount',
        },
        'documented_outcome_count': {
            'value': _float_value(exposure.get('documentedOutcomeCount')),
            'source': 'nursingExposure.documentedOutcomeCount',
        },
        'documented_exam_count': {
            'value': _float_value(exposure.get('documentedExamCount')),
            'source': 'nursingExposure.documentedExamCount',
        },
        'abnormal_vital_count': {
            'value': _float_value(change_signals.get('abnormalVitalCount')),
            'source': 'nursingExposure.documentedChangeSignals.abnormalVitalCount',
        },
        'closing_summary_present': {
            'value': 1.0 if change_signals.get('closingSummaryPresent') else 0.0,
            'source': 'nursingExposure.documentedChangeSignals.closingSummaryPresent',
        },
        'sbar_present': {
            'value': 1.0 if change_signals.get('sbarPresent') else 0.0,
            'source': 'nursingExposure.documentedChangeSignals.sbarPresent',
        },
        'shift_closure_documented': {
            'value': 1.0 if quality.get('shiftClosureDocumented') else 0.0,
            'source': 'qualitySignals.shiftClosureDocumented',
        },
        'missingness_rate': {
            'value': _float_value(uncertainty.get('missingnessRate')),
            'source': 'uncertaintySignals.missingnessRate',
        },
        'support_level': {
            'value': _float_value(uncertainty.get('supportLevel')),
            'source': 'uncertaintySignals.supportLevel',
        },
        'severity_weight': {
            'value': _float_value(severity_weight),
            'source': 'nursingExposure.severityWeight',
        },
    }


def _build_derived_contextual_fields(
    observed_fields: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    diagnosis_count = _observed_value(observed_fields, 'diagnosis_count')
    risk_flag_count = _observed_value(observed_fields, 'risk_flag_count')
    age_years = _observed_value(observed_fields, 'age_years')
    severity_weight = _observed_value(observed_fields, 'severity_weight')
    abnormal_vital_count = _observed_value(observed_fields, 'abnormal_vital_count')
    pending_critical_task_count = _observed_value(observed_fields, 'pending_critical_task_count')
    documented_medication_count = _observed_value(observed_fields, 'documented_medication_count')
    documented_procedure_count = _observed_value(observed_fields, 'documented_procedure_count')
    documented_device_use_count = _observed_value(observed_fields, 'documented_device_use_count')
    documented_outcome_count = _observed_value(observed_fields, 'documented_outcome_count')
    documented_exam_count = _observed_value(observed_fields, 'documented_exam_count')
    shift_closure_documented = _observed_value(observed_fields, 'shift_closure_documented')
    closing_summary_present = _observed_value(observed_fields, 'closing_summary_present')
    support_level = _observed_value(observed_fields, 'support_level')
    overlay_ids = observed_fields.get('overlay_ids', {}).get('value') if isinstance(observed_fields.get('overlay_ids'), dict) else []

    age_band = 1.0 if age_years >= 85 else 0.75 if age_years >= 75 else 0.5 if age_years >= 65 else 0.25 if age_years >= 50 else 0.0
    diagnosis_burden = min(diagnosis_count / 4.0, 1.0)
    risk_burden = min(risk_flag_count / 3.0, 1.0)
    abnormal_burden = min(abnormal_vital_count / 3.0, 1.0)
    task_burden = min(pending_critical_task_count / 3.0, 1.0)
    therapeutic_burden = min(
        (
            documented_medication_count
            + documented_procedure_count
            + documented_device_use_count * 1.5
            + documented_outcome_count * 0.5
            + documented_exam_count * 0.5
        )
        / 8.0,
        1.0,
    )
    overlay_burden = min(len(overlay_ids) / 3.0, 1.0) if isinstance(overlay_ids, list) else 0.0
    support_gap = max(0.0, min(1.0, 1.0 - support_level))
    continuity_gap = max(0.0, 1.0 - max(shift_closure_documented, closing_summary_present))

    return {
        'baseline_complexity': {
            'value': round(min(1.0, (diagnosis_burden * 0.35) + (risk_burden * 0.25) + (severity_weight * 0.25) + (age_band * 0.15)), 4),
            'rule': 'weighted_case_mix_baseline',
            'inputs': ['diagnosis_count', 'risk_flag_count', 'severity_weight', 'age_years'],
        },
        'surveillance_intensity': {
            'value': round(min(1.0, (abnormal_burden * 0.5) + (task_burden * 0.3) + (support_gap * 0.2)), 4),
            'rule': 'abnormal_vitals_plus_pending_critical_tasks_plus_support_gap',
            'inputs': ['abnormal_vital_count', 'pending_critical_task_count', 'support_level'],
        },
        'therapeutic_load': {
            'value': round(therapeutic_burden, 4),
            'rule': 'weighted_documented_interventions_and_exams',
            'inputs': [
                'documented_medication_count',
                'documented_procedure_count',
                'documented_device_use_count',
                'documented_outcome_count',
                'documented_exam_count',
            ],
        },
        'temporal_criticality': {
            'value': round(min(1.0, (task_burden * 0.5) + (abnormal_burden * 0.35) + (continuity_gap * 0.15)), 4),
            'rule': 'pending_critical_tasks_plus_abnormal_vitals_plus_handover_gaps',
            'inputs': ['pending_critical_task_count', 'abnormal_vital_count', 'shift_closure_documented', 'closing_summary_present'],
        },
        'continuity_risk': {
            'value': round(min(1.0, (continuity_gap * 0.45) + (support_gap * 0.35) + (task_burden * 0.2)), 4),
            'rule': 'handover_gap_plus_support_gap_plus_pending_tasks',
            'inputs': ['shift_closure_documented', 'closing_summary_present', 'support_level', 'pending_critical_task_count'],
        },
        'dependency_load': {
            'value': round(min(1.0, (documented_device_use_count / 3.0 * 0.45) + (severity_weight * 0.35) + (risk_burden * 0.2)), 4),
            'rule': 'devices_plus_severity_plus_risk_flags',
            'inputs': ['documented_device_use_count', 'severity_weight', 'risk_flag_count'],
        },
        'coordination_complexity': {
            'value': round(min(1.0, (overlay_burden * 0.3) + (task_burden * 0.35) + (continuity_gap * 0.35)), 4),
            'rule': 'overlay_pressure_plus_pending_tasks_plus_handover_gap',
            'inputs': ['overlay_ids', 'pending_critical_task_count', 'shift_closure_documented', 'closing_summary_present'],
        },
    }


def _build_contextual_signal(
    *,
    clinical_context: dict[str, Any],
    observed_fields: dict[str, dict[str, Any]],
    derived_fields: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    profile_id = clinical_context.get('profileId')
    overlay_ids = clinical_context.get('overlayIds') if isinstance(clinical_context.get('overlayIds'), list) else []
    case_mix_envelope = {
        'baseline_complexity': derived_fields['baseline_complexity']['value'],
        'surveillance_intensity': derived_fields['surveillance_intensity']['value'],
        'therapeutic_load': derived_fields['therapeutic_load']['value'],
        'temporal_criticality': derived_fields['temporal_criticality']['value'],
        'continuity_risk': derived_fields['continuity_risk']['value'],
        'dependency_load': derived_fields['dependency_load']['value'],
        'coordination_complexity': derived_fields['coordination_complexity']['value'],
        'explainability_summary': _contextual_explainability_summary(
            profile_id=profile_id,
            overlay_ids=overlay_ids,
            observed_fields=observed_fields,
            derived_fields=derived_fields,
        ),
        'observed_fields': observed_fields,
        'derived_fields': derived_fields,
        'pending_hospital_source_fields': PENDING_HOSPITAL_SOURCE_FIELDS,
    }
    return {
        'contract_version': CONTEXTUAL_SIGNAL_CONTRACT_VERSION,
        'profile_id': profile_id,
        'overlay_ids': overlay_ids,
        'case_mix_envelope': case_mix_envelope,
    }


def _severity(vitals: dict[str, Any], scales: dict[str, Any], risk_flags: list[str]) -> float | None:
    score = min(float(vitals.get('abnormalVitalCount') or 0) * 0.75, 2.0)
    if isinstance(scales.get('glasgow'), (int, float)):
        score += 2.0 if scales['glasgow'] <= 8 else 1.0 if scales['glasgow'] <= 12 else 0.0
    if isinstance(scales.get('braden'), (int, float)) and scales['braden'] <= 14:
        score += 1.0
    if vitals.get('avpu') in {'V', 'P', 'U', 'C'}:
        score += 1.5
    score += min(len(risk_flags) * 0.4, 1.0)
    return round(min(score / 5.0, 1.0), 4) if score > 0 else None


def _contextual_explainability_summary(
    *,
    profile_id: str | None,
    overlay_ids: list[str],
    observed_fields: dict[str, dict[str, Any]],
    derived_fields: dict[str, dict[str, Any]],
) -> str:
    profile_part = f'profile={profile_id}' if profile_id else 'profile=unknown'
    overlay_part = f"overlays={','.join(overlay_ids)}" if overlay_ids else 'overlays=none'
    diagnosis_count = int(_observed_value(observed_fields, 'diagnosis_count'))
    risk_flag_count = int(_observed_value(observed_fields, 'risk_flag_count'))
    abnormal_vital_count = int(_observed_value(observed_fields, 'abnormal_vital_count'))
    pending_critical_task_count = int(_observed_value(observed_fields, 'pending_critical_task_count'))
    baseline_complexity = derived_fields['baseline_complexity']['value']
    surveillance_intensity = derived_fields['surveillance_intensity']['value']
    therapeutic_load = derived_fields['therapeutic_load']['value']
    return (
        f'{profile_part}; {overlay_part}; diagnoses={diagnosis_count}; risk_flags={risk_flag_count}; '
        f'abnormal_vitals={abnormal_vital_count}; pending_critical_tasks={pending_critical_task_count}; '
        f'baseline_complexity={baseline_complexity}; surveillance_intensity={surveillance_intensity}; '
        f'therapeutic_load={therapeutic_load}. Deterministic stratification only; not causal attribution.'
    )


def _numeric(resource: dict[str, Any]) -> float | int | None:
    quantity = resource.get('valueQuantity') or {}
    value = quantity.get('value') if isinstance(quantity, dict) else None
    if isinstance(value, (int, float)):
        return value
    integer_value = resource.get('valueInteger')
    if isinstance(integer_value, int):
        return integer_value
    return None


def _code_value(concept: Any) -> str | None:
    codings = concept.get('coding') if isinstance(concept, dict) else []
    for coding in codings or []:
        value = _safe((coding or {}).get('code'))
        if value:
            return value
    return None


def _component_code(component: dict[str, Any]) -> str | None:
    concept = component.get('code') or {}
    codings = concept.get('coding') if isinstance(concept, dict) else []
    for coding in codings or []:
        system = _safe((coding or {}).get('system'))
        code = _safe((coding or {}).get('code'))
        if system == CONTEXT_COMPONENT_SYSTEM and code:
            return code
    return None


def _profile_value(value: Any) -> tuple[str | None, str | None]:
    raw = _safe(value)
    if not raw:
        return None, None
    match = PROFILE_COMPONENT_RE.match(raw)
    if not match:
        return raw, None
    return match.group('label').strip(), match.group('identifier').strip()


def _has_code(resource: dict[str, Any], system: str, code: str) -> bool:
    concept = resource.get('code') or {}
    codings = concept.get('coding') if isinstance(concept, dict) else []
    return any(_safe((coding or {}).get('system')) == system and _safe((coding or {}).get('code')) == code for coding in codings or [])


def _is_outcome(observation: dict[str, Any]) -> bool:
    concept = observation.get('code') or {}
    codings = concept.get('coding') if isinstance(concept, dict) else []
    if any(_safe((coding or {}).get('system')) == NOC_SYSTEM for coding in codings or []):
        return True
    for category in observation.get('category') or []:
        codings = category.get('coding') if isinstance(category, dict) else []
        if any(_safe((coding or {}).get('system')) == OBS_CATEGORY_SYSTEM and _safe((coding or {}).get('code')) == OBS_CATEGORY_OUTCOME for coding in codings or []):
            return True
    return False


def _is_exam(observation: dict[str, Any]) -> bool:
    for category in observation.get('category') or []:
        codings = category.get('coding') if isinstance(category, dict) else []
        if any(_safe((coding or {}).get('system')) == OBS_CATEGORY_SYSTEM and _safe((coding or {}).get('code')) in {'laboratory', 'imaging'} for coding in codings or []):
            return True
    return False


def _safe(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _float_value(value: Any) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _observed_value(observed_fields: dict[str, dict[str, Any]], key: str) -> float:
    payload = observed_fields.get(key)
    if not isinstance(payload, dict):
        return 0.0
    return _float_value(payload.get('value'))


def _validated_window(start_value: Any, end_value: Any) -> tuple[str | None, str | None, bool]:
    raw_start = _safe(start_value)
    raw_end = _safe(end_value)
    if not raw_start and not raw_end:
        return None, None, False
    parsed_start = _dt(raw_start)
    parsed_end = _dt(raw_end)
    if parsed_start is None or parsed_end is None:
        return None, None, True
    return _ts(parsed_start), _ts(parsed_end), False


def _dt(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    normalized = value[:-1] + '+00:00' if value.endswith('Z') else value
    try:
        parsed = datetime.datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc)


def _clinical_reference_datetime(
    *,
    bundle: dict[str, Any],
    composition: dict[str, Any] | None,
    encounter: dict[str, Any] | None,
    window_start: str | None,
    window_end: str | None,
) -> datetime.datetime | None:
    for candidate in (
        window_end,
        window_start,
        _safe((composition or {}).get('date')),
        _safe(((encounter or {}).get('period') or {}).get('end')),
        _safe(((encounter or {}).get('period') or {}).get('start')),
        _safe((bundle.get('signature') or [{}])[0].get('when')) if isinstance(bundle.get('signature'), list) else None,
        _safe(bundle.get('timestamp')),
    ):
        parsed = _dt(candidate)
        if parsed is not None:
            return parsed
    return None


def _age(birth_date: str | None, *, reference: datetime.datetime | None) -> int | None:
    if not birth_date:
        return None
    parsed = _dt(f'{birth_date}T00:00:00Z')
    if parsed is None or reference is None:
        return None
    reference_date = reference.date()
    years = reference_date.year - parsed.date().year
    if (reference_date.month, reference_date.day) < (parsed.date().month, parsed.date().day):
        years -= 1
    return years if years >= 0 else None


def _is_stale(window_end: str | None) -> bool:
    parsed = _dt(window_end)
    return bool(parsed and parsed < timezone.now().astimezone(datetime.timezone.utc) - datetime.timedelta(hours=24))


def _ts(now: datetime.datetime | None = None) -> str:
    current = now or timezone.now()
    return current.astimezone(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')



