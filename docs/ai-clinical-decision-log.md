# Clinical Decision Log (IA asistida)

Estado revisado contra el repo el 2026-03-28.

## Proposito

Registrar de forma minima, trazable y no punitiva cuando un profesional humano aplica o descarta una sugerencia asistida por IA ya existente en HANDOVER.

Este registro:
- mejora trazabilidad operativa del piloto;
- no equivale a cierre regulatorio total;
- no sustituye supervision clinica, QMS ni validacion prospectiva.

## Que se registra

- actor autenticado derivado del token (`actor_id`, `actor_role`);
- paciente y unidad tecnica canonica (`patient_id`, `unit_id`);
- origen de la sugerencia (`ai_generate_sbar`, `ai_refine_sbar`, `ai_nic_suggestions`, `ai_noc_suggestions`);
- decision humana (`accepted`, `applied`, `rejected`, `dismissed`);
- `reason_code` breve cuando existe;
- `created_at`;
- metadatos minimos no-PHI:
  - conteos;
  - codigos estructurados NOC/NIC cuando existen;
  - hashes de sugerencias cuando el contenido podria contener contexto clinico.

## Que no se registra

- nombres de pacientes;
- texto libre clinico completo;
- payload IA crudo;
- evaluacion de productividad individual;
- ranking, fairness dashboard o vigilancia laboral.

## Endpoint

- `POST /api/ai/clinical-decision`
- auth requerida;
- roles clinicos permitidos: `nurse`, `supervisor`, `admin`;
- scope requerido: `handover:write`;
- la unidad se valida con el mismo control de scope endurecido del backend;
- el modelo es append-only a nivel semantico: cada decision crea un evento nuevo.

## Cobertura actual

Cubierto en esta iteracion:
- aplicacion de SBAR generada o refinada con IA;
- aplicacion o descarte explicito de sugerencias NIC;
- aplicacion o descarte explicito de sugerencias NOC pendientes de revision.

Fuera de esta iteracion:
- sugerencias solo visualizadas sin accion humana;
- panel administrativo de lectura;
- mezcla con ICEA scoring, submit FHIR, queue/sync u otras superficies no tocadas.

## Comportamiento ante fallo

El fallo del logger no bloquea el handover ni altera `submit`.

La persistencia del log es best-effort desde frontend y validada/autenticada en backend.
