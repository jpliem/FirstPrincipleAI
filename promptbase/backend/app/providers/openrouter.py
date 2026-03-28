import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMConfig, LLMProvider


class OpenRouterProvider(LLMProvider):
    BASE_URL = "https://openrouter.ai/api/v1"

    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        base_url = config.base_url or self.BASE_URL
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                json={"model": config.model, "messages": full_messages, "temperature": config.temperature, "max_tokens": config.max_tokens, "stream": True},
                timeout=120.0,
            ) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        base_url = config.base_url or self.BASE_URL
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/embeddings",
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={"model": config.model, "input": texts}, timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return 128000
