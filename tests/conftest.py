import sys
import types

try:  # pragma: no cover - only executed when openai is missing
    import openai  # type: ignore
except ImportError:  # pragma: no cover
    audio_namespace = types.SimpleNamespace(transcriptions=types.SimpleNamespace(create=lambda **_kwargs: None))
    chat_namespace = types.SimpleNamespace(completions=types.SimpleNamespace(create=lambda **_kwargs: None))

    class OpenAI:  # minimal stub for tests
        def __init__(self):
            self.audio = audio_namespace
            self.chat = chat_namespace

    stub = types.ModuleType('openai')
    stub.OpenAI = OpenAI
    sys.modules['openai'] = stub
