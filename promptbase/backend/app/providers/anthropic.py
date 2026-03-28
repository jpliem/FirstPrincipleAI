from collections.abc import AsyncIterator

import anthropic

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "claude-sonnet-4-20250514": 200000,
    "claude-opus-4-20250514": 200000,
    "claude-haiku-4-20250414": 200000,
}


class AnthropicProvider(LLMProvider):
    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        client = anthropic.AsyncAnthropic(api_key=config.api_key)
        async with client.messages.stream(
            model=config.model, max_tokens=config.max_tokens, system=system_prompt,
            messages=messages, temperature=config.temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        raise NotImplementedError("Use OpenAI or Voyage for embeddings with Anthropic")

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 200000)
