from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class LLMConfig:
    model: str
    api_key: str = ""
    base_url: str = ""
    temperature: float = 0.7
    max_tokens: int = 4096
    max_context: int = 0  # 0 = use provider default


class LLMProvider(ABC):
    @abstractmethod
    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        yield ""

    @abstractmethod
    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        ...

    @abstractmethod
    def count_tokens(self, text: str) -> int:
        ...

    @abstractmethod
    def max_context_tokens(self, model: str) -> int:
        ...
