def count_tokens_approx(text: str) -> int:
    return max(1, len(text) // 4)


class TokenBudget:
    def __init__(self, model_context_limit: int):
        self.model_context_limit = model_context_limit
        self.response_reserve = 0
        self.history_reserve = 0
        self.sections: list[dict] = []
        self.core_tokens = 0
        self.core_mode = None

    def reserve_for_response(self, tokens: int):
        self.response_reserve = tokens

    def reserve_for_history(self, tokens: int):
        self.history_reserve = tokens

    @property
    def available(self) -> int:
        return self.model_context_limit - self.response_reserve - self.history_reserve - self.core_tokens

    def add_core_with_fallback(self, full_core: str, condensed_core: str | None) -> str:
        full_tokens = count_tokens_approx(full_core)
        budget_for_core = self.model_context_limit - self.response_reserve - self.history_reserve

        if full_tokens <= budget_for_core * 0.6:
            self.core_tokens = full_tokens
            self.sections.insert(0, {"name": "core", "content": full_core, "tokens": full_tokens, "priority": 1000})
            self.core_mode = "full"
            return "full"

        if condensed_core:
            condensed_tokens = count_tokens_approx(condensed_core)
            self.core_tokens = condensed_tokens
            self.sections.insert(0, {"name": "core", "content": condensed_core, "tokens": condensed_tokens, "priority": 1000})
            self.core_mode = "condensed"
            return "condensed"

        self.core_tokens = full_tokens
        self.sections.insert(0, {"name": "core", "content": full_core, "tokens": full_tokens, "priority": 1000})
        self.core_mode = "full"
        return "full"

    def add_section(self, name: str, content: str, priority: int = 50):
        tokens = count_tokens_approx(content)
        self.sections.append({"name": name, "content": content, "tokens": tokens, "priority": priority})

    def fits(self) -> bool:
        total = sum(s["tokens"] for s in self.sections)
        return total <= self.available + self.core_tokens

    def remaining(self) -> int:
        used = sum(s["tokens"] for s in self.sections)
        return self.model_context_limit - self.response_reserve - self.history_reserve - used

    def compile(self) -> dict:
        budget = self.model_context_limit - self.response_reserve - self.history_reserve

        sorted_sections = sorted(self.sections, key=lambda s: s["priority"], reverse=True)

        included = []
        total_tokens = 0
        trimmed = []

        for section in sorted_sections:
            if total_tokens + section["tokens"] <= budget:
                included.append(section)
                total_tokens += section["tokens"]
            else:
                trimmed.append(section["name"])

        original_order = {s["name"]: i for i, s in enumerate(self.sections)}
        included.sort(key=lambda s: original_order.get(s["name"], 999))

        return {
            "system_prompt": "\n\n---\n\n".join(s["content"] for s in included),
            "included": [s["name"] for s in included],
            "trimmed": trimmed,
            "total_tokens": total_tokens,
            "budget": budget,
            "remaining": budget - total_tokens,
        }
