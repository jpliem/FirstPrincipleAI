import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMConfig, LLMProvider

# Cache for dynamically fetched context sizes
_context_cache: dict[str, int] = {}


class OllamaProvider(LLMProvider):
    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        base_url = (config.base_url or "http://localhost:11434").rstrip("/")
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{base_url}/api/chat",
                    json={
                        "model": config.model,
                        "messages": full_messages,
                        "stream": True,
                        "options": {
                            "temperature": config.temperature,
                            "num_predict": config.max_tokens,
                            "num_ctx": config.max_context or 32768,
                        },
                    },
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        yield f"[Ollama error {response.status_code}: {body.decode()[:300]}]"
                        return

                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                            if chunk.get("error"):
                                yield f"[Ollama error: {chunk['error']}]"
                                return
                            msg = chunk.get("message", {})
                            content = msg.get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue
            except httpx.ConnectError as e:
                yield f"[Cannot connect to Ollama at {base_url}: {e}]"
            except httpx.ReadTimeout:
                yield f"[Ollama read timeout — model may be loading or server is slow]"
            except Exception as e:
                yield f"[Ollama error: {type(e).__name__}: {e}]"

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        base_url = (config.base_url or "http://localhost:11434").rstrip("/")
        embeddings = []
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            for text in texts:
                response = await client.post(
                    f"{base_url}/api/embeddings",
                    json={"model": config.model, "prompt": text},
                )
                response.raise_for_status()
                data = response.json()
                embeddings.append(data["embedding"])
        return embeddings

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        if model in _context_cache:
            return _context_cache[model]
        return 32768  # safe default, will be overridden by fetch_context_size

    async def fetch_context_size(self, model: str, base_url: str) -> int:
        """Query Ollama /api/show to get the model's actual context length."""
        base_url = base_url.rstrip("/")
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                res = await client.post(f"{base_url}/api/show", json={"name": model})
                if res.status_code == 200:
                    data = res.json()
                    model_info = data.get("model_info", {})
                    for key, value in model_info.items():
                        if "context_length" in key:
                            ctx = int(value)
                            _context_cache[model] = ctx
                            return ctx
        except Exception:
            pass
        return 32768
