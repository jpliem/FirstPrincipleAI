from app.providers.anthropic import AnthropicProvider
from app.providers.base import LLMProvider
from app.providers.ollama import OllamaProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.openrouter import OpenRouterProvider

_PROVIDERS: dict[str, type[LLMProvider]] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "openrouter": OpenRouterProvider,
    "ollama": OllamaProvider,
}


def get_provider(name: str) -> LLMProvider | None:
    cls = _PROVIDERS.get(name)
    if cls is None:
        return None
    return cls()


def list_providers() -> list[str]:
    return list(_PROVIDERS.keys())
