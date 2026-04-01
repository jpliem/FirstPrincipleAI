import json
import logging
from collections.abc import AsyncIterator

import httpx
import openai
import tiktoken

from app.providers.base import LLMConfig, LLMProvider

logger = logging.getLogger(__name__)

MODEL_CONTEXT = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
}


class OpenAIProvider(LLMProvider):
    async def stream_chat(self, system_prompt: str, messages: list[dict], config: LLMConfig) -> AsyncIterator[str]:
        full_messages = [{"role": "system", "content": system_prompt}] + messages
        base_url = config.base_url.rstrip("/") if config.base_url else ""

        if base_url:
            # Custom server (llama.cpp, vllm, etc.) — use httpx directly to avoid SDK auth issues
            url = base_url + "/v1/chat/completions" if not base_url.endswith("/v1") else base_url + "/chat/completions"
            headers = {"Content-Type": "application/json"}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"

            body = {
                "model": config.model,
                "messages": full_messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
                "stream": True,
            }
            print(f"[OpenAI-compat] POST {url} model={config.model} max_tokens={config.max_tokens}", flush=True)

            timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                try:
                    async with client.stream("POST", url, headers=headers, json=body) as response:
                        if response.status_code != 200:
                            error_body = await response.aread()
                            print(f"[OpenAI-compat] ERROR {response.status_code} from {url}: {error_body.decode()[:500]}", flush=True)
                            yield f"[Error {response.status_code}: {error_body.decode()[:300]}]"
                            return

                        in_reasoning = False
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data = line[6:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                # Qwen3/deepseek send thinking in reasoning_content
                                reasoning = delta.get("reasoning_content", "")
                                if reasoning:
                                    if not in_reasoning:
                                        yield "<think>"
                                        in_reasoning = True
                                    yield reasoning
                                content = delta.get("content", "")
                                if content:
                                    if in_reasoning:
                                        yield "</think>"
                                        in_reasoning = False
                                    yield content
                            except json.JSONDecodeError:
                                continue
                        # Close thinking if stream ended during reasoning
                        if in_reasoning:
                            yield "</think>"
                except httpx.ConnectError as e:
                    yield f"[Cannot connect to {base_url}: {e}]"
                except httpx.ReadTimeout:
                    yield f"[Read timeout from {base_url}]"
                except Exception as e:
                    yield f"[Error: {type(e).__name__}: {e}]"
        else:
            # Standard OpenAI API
            client = openai.AsyncOpenAI(api_key=config.api_key)
            stream = await client.chat.completions.create(
                model=config.model, messages=full_messages,
                temperature=config.temperature, max_tokens=config.max_tokens, stream=True,
            )
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        if config.base_url:
            base_url = config.base_url.rstrip("/")
            url = base_url + "/v1/embeddings" if not base_url.endswith("/v1") else base_url + "/embeddings"
            headers = {"Content-Type": "application/json"}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                response = await client.post(url, headers=headers, json={"model": config.model, "input": texts})
                response.raise_for_status()
                data = response.json()
                return [item["embedding"] for item in data["data"]]
        else:
            client = openai.AsyncOpenAI(api_key=config.api_key)
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
