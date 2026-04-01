from collections.abc import AsyncIterator

import openai
import tiktoken

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
}


class OpenAIProvider(LLMProvider):
    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        client_kwargs = {"api_key": config.api_key or "no-key"}
        if config.base_url:
            url = config.base_url.rstrip("/")
            client_kwargs["base_url"] = url if url.endswith("/v1") else url + "/v1"
        client = openai.AsyncOpenAI(**client_kwargs)
        full_messages = [{"role": "system", "content": system_prompt}] + messages
        stream = await client.chat.completions.create(
            model=config.model, messages=full_messages,
            temperature=config.temperature, max_tokens=config.max_tokens, stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        client_kwargs = {"api_key": config.api_key or "no-key"}
        if config.base_url:
            url = config.base_url.rstrip("/")
            client_kwargs["base_url"] = url if url.endswith("/v1") else url + "/v1"
        client = openai.AsyncOpenAI(**client_kwargs)
        response = await client.embeddings.create(model=config.model, input=texts)
        return [item.embedding for item in response.data]

    def count_tokens(self, text: str) -> int:
        try:
            enc = tiktoken.encoding_for_model("gpt-4o")
            return len(enc.encode(text))
        except Exception:
            return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 128000)
