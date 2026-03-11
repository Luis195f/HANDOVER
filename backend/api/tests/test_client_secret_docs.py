from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
FILES_TO_CHECK = [
    REPO_ROOT / 'README.md',
    REPO_ROOT / '.env.example',
    REPO_ROOT / 'docs' / 'environment-variables.md',
    REPO_ROOT / 'docs' / 'security-and-auth.md',
    REPO_ROOT / 'docs' / 'DEPLOY.md',
]
BANNED_CLIENT_SECRET_HINTS = [
    'EXPO_PUBLIC_OPENAI_API_KEY',
    'EXPO_PUBLIC_AI_SBAR_API_KEY',
    'EXPO_PUBLIC_API_TOKEN',
    'EXPO_PUBLIC_AUTH_TOKEN',
    'EXPO_PUBLIC_EIDAS_CLIENT_ID',
    'EXPO_PUBLIC_EIDAS_CLIENT_SECRET',
    'EXPO_PUBLIC_EIDAS_API_KEY',
    'EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY',
]


def test_docs_do_not_reintroduce_public_secret_variables():
    combined = '\n'.join(path.read_text(encoding='utf-8') for path in FILES_TO_CHECK)
    for token in BANNED_CLIENT_SECRET_HINTS:
        assert token not in combined
