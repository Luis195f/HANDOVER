from __future__ import annotations

import datetime
import re
from hashlib import sha256
from typing import Any

from django.utils import timezone

from backend.audit.utils import canonical_json

CONTRACT_VERSION = 'handover-icea-bridge-v1'
MAPPER_VERSION = '2026-03-08'
SOURCE = 'HANDOVER'
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
SHIFT_RE = re.compile(r'^Shift:\s*(?P<start>.+?)\s*(?:→|->|>)\s*(?P<end>.+?)\s*$')


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
        'ageYears': _age(patient.get('birthDate') if isinstance(patient, dict) else None) is not None,
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
            'nurseId': actors['primaryNurseId'],
            'coSignerIds': actors['coSignerIds'],
            'documentedAuthorId': actors['authorId'],
            'shift': shift,
            'handoverLoad': {
                'census': admin.get('census'),
                'incomingStaffCount': admin.get('incomingStaffCount'),
                'outgoingStaffCount': admin.get('outgoingStaffCount'),
                'incidentCount': admin.get('incidentCount'),
            },
        },
        'caseMix': {
            'ageYears': _age(patient.get('birthDate') if isinstance(patient, dict) else None),
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
                'primaryNurseId': actors['primaryNurseId'],
                'coSignerIds': actors['coSignerIds'],
                'signatureCount': actors['signatureCount'],
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
    }
    return payload


def compute_payload_hash(payload: dict[str, Any]) -> str:
    return sha256(canonical_json(payload)).hexdigest()


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


def _age(birth_date: str | None) -> int | None:
    if not birth_date:
        return None
    parsed = _dt(f'{birth_date}T00:00:00Z')
    if parsed is None:
        return None
    today = timezone.now().date()
    years = today.year - parsed.date().year
    if (today.month, today.day) < (parsed.date().month, parsed.date().day):
        years -= 1
    return years if years >= 0 else None


def _is_stale(window_end: str | None) -> bool:
    parsed = _dt(window_end)
    return bool(parsed and parsed < timezone.now().astimezone(datetime.timezone.utc) - datetime.timedelta(hours=24))


def _ts(now: datetime.datetime | None = None) -> str:
    current = now or timezone.now()
    return current.astimezone(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')



