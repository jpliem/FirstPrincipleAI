import pytest

from app.providers.base import LLMProvider
from app.providers.registry import get_provider


def test_base_provider_is_abstract():
    with pytest.raises(TypeError):
        LLMProvider()


def test_registry_returns_none_for_unknown():
    provider = get_provider("nonexistent")
    assert provider is None


def test_registry_returns_anthropic():
    provider = get_provider("anthropic")
    assert provider is not None
    assert isinstance(provider, LLMProvider)


def test_registry_returns_openai():
    provider = get_provider("openai")
    assert provider is not None


def test_registry_returns_openrouter():
    provider = get_provider("openrouter")
    assert provider is not None


def test_registry_returns_ollama():
    provider = get_provider("ollama")
    assert provider is not None
