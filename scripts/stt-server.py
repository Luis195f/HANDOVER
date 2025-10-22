# scripts/stt-server.py
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import tempfile, os, re, os

app = FastAPI(title="Handover STT")

# Elige modelo por variable de entorno (small/base). small mejora español.
MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")  # CPU-friendly

GLOSARIO = [
    "cefazolina", "paracetamol", "hidratación", "antitérmico", "cefazolina 1 gramo",
    "NEWS2", "PA", "PAS", "FC", "SpO2", "AVPU", "O2", "EV", "IM", "SOS"
]
BASE_PROMPT_ES = (
    "Dictado clínico de enfermería en español, con términos sanitarios. "
    "Usa abreviaturas correctas: RR (frecuencia respiratoria), SpO2, Temp, PAS, FC, AVPU, O2. "
    f"Vocabulario: {', '.join(GLOSARIO)}. "
)

def clean_text(t: str) -> str:
    t = re.sub(r"\s+", " ", t).strip()
    # Correcciones comunes
    repl = {
        "spo2": "SpO₂", "pas": "PAS", "fc": "FC", "rr": "RR", "avpu": "AVPU",
        " o 2": " O₂", " o2": " O₂", "sos": "SOS"
    }
    low = t.lower()
    for k, v in repl.items():
        low = low.replace(k, v)
    # Capitaliza inicio de frases
    low = ". ".join(s.strip().capitalize() for s in re.split(r"[\.!\?]\s*", low) if s.strip())
    return low

@app.post("/stt")
async def stt(
    file: UploadFile = File(...),
    hint: str = Form("", description="Pista breve de contexto (ej: UCI, pediatría)")
):
    try:
        suffix = os.path.splitext(file.filename or "audio.m4a")[1] or ".m4a"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        initial_prompt = (BASE_PROMPT_ES + (" Contexto: " + hint if hint else "")).strip()

        segments, info = model.transcribe(
            tmp_path,
            language="es",                # Fuerza español
            task="transcribe",
            beam_size=5,                  # Más calidad (más lento que 1)
            vad_filter=True,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        os.remove(tmp_path)
        return JSONResponse({"text": clean_text(text)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
