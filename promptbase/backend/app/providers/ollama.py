import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "llama3": 8192, "llama3:70b": 8192,
    "mixtral": 32768, "codellama": 16384, "deepseek-coder": 16384,
}


class OllamaProvider(LLMProvider):
    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        base_url = config.base_url or "http://localhost:11434"
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", f"{base_url}/api/chat",
                json={"model": config.model, "messages": full_messages, "stream": True, "options": {"temperature": config.temperature, "num_predict": config.max_tokens}},
                timeout=120.0,
            ) as response:
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        base_url = config.base_url or "http://localhost:11434"
        embeddings = []
        async with httpx.AsyncClient() as client:
            for text in texts:
                response = await client.post(
                    f"{base_url}/api/embeddings",
                    json={"model": config.model, "prompt": text}, timeout=60.0,
                )
                response.raise_for_status()
                data = response.json()
                embeddings.append(data["embedding"])
        return embeddings

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 8192)
