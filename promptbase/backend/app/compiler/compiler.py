from app.compiler.budget import TokenBudget, count_tokens_approx
from app.compiler.classifier import classify_request, detect_mode

SAFETY_WRAPPER = """You are operating using a managed prompt pack.
Apply the loaded instructions as operating rules.
Prefer the most specific applicable rule.
If rules conflict: 1) safety and correctness, 2) explicit task constraints, 3) domain-specific modules, 4) general framework rules.
State assumptions clearly. Do not invent missing facts."""


class PromptCompiler:
    def __init__(
        self,
        modules: list[dict],
        modes: list[dict],
        model_context_limit: int,
        condensed_core: str | None,
    ):
        self.modules = sorted(modules, key=lambda m: m["sort_order"])
        self.modes = {m["name"]: m["prompt_text"] for m in modes}
        self.model_context_limit = model_context_limit
        self.condensed_core = condensed_core

    def compile(
        self,
        user_text: str,
        mode: str | None,
        doc_context: str,
        history_tokens: int = 0,
    ) -> dict:
        budget = TokenBudget(model_context_limit=self.model_context_limit)
        budget.reserve_for_response(4096)
        budget.reserve_for_history(history_tokens)

        matched_domains = classify_request(user_text)
        detected_mode = mode or detect_mode(user_text)

        core_parts = []
        always_parts = []
        domain_parts = []
        modules_loaded = []

        for mod in self.modules:
            if mod["layer"] == "core":
                core_parts.append(mod["content"])
                modules_loaded.append(mod["name"])
            elif mod["layer"] == "always":
                always_parts.append(mod["content"])
                modules_loaded.append(mod["name"])
            elif mod["layer"] == "domain":
                mod_tags = set(t.lower() for t in mod.get("tags", []))
                user_lower = user_text.lower()
                if any(tag in user_lower for tag in mod_tags):
                    domain_parts.append(mod["content"])
                    modules_loaded.append(mod["name"])

        full_core = "\n\n".join(core_parts)
        budget.add_core_with_fallback(full_core, self.condensed_core)

        if always_parts:
            always_text = "\n\n".join(always_parts)
            budget.add_section("always", always_text, priority=90)

        for i, content in enumerate(domain_parts):
            budget.add_section(f"domain_{i}", content, priority=50)

        mode_text = ""
        if detected_mode and detected_mode in self.modes:
            mode_text = self.modes[detected_mode]
            budget.add_section("mode", mode_text, priority=70)

        if doc_context:
            budget.add_section("documents", f"## Reference Documents\n\n{doc_context}", priority=30)

        result = budget.compile()

        system_prompt = SAFETY_WRAPPER + "\n\n---\n\n" + result["system_prompt"]

        return {
            "system_prompt": system_prompt,
            "total_tokens": result["total_tokens"] + count_tokens_approx(SAFETY_WRAPPER),
            "modules_loaded": modules_loaded,
            "domains_matched": list(matched_domains),
            "mode": detected_mode,
            "trimmed": result["trimmed"],
            "budget_remaining": result["remaining"],
            "core_mode": budget.core_mode,
        }
