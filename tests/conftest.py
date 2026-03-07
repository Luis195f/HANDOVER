import pytest


@pytest.fixture
def anyio_backend() -> str:
    # The CI/test environment used here does not ship Trio; keep AnyIO on asyncio.
    return "asyncio"
