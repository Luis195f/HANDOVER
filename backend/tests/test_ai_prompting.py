from backend.ai_client import build_sbar_prompt


def test_build_sbar_prompt_has_guardrails():
    prompt = build_sbar_prompt("Contexto breve", "es")
    assert "dato no disponible" in prompt
    assert "Asistente de apoyo" in prompt
    assert "No incluyas dosis" in prompt
