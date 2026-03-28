import pytest

from app.compiler.compiler import PromptCompiler


@pytest.fixture
def sample_modules():
    return [
        {"name": "identity", "layer": "core", "content": "You are a first-principles analyst.", "tags": [], "priority": 100, "sort_order": 0},
        {"name": "reasoning", "layer": "core", "content": "Apply structured reasoning.", "tags": [], "priority": 100, "sort_order": 1},
        {"name": "execution", "layer": "core", "content": "Follow execution doctrine.", "tags": [], "priority": 100, "sort_order": 2},
        {"name": "output", "layer": "core", "content": "Format output clearly.", "tags": [], "priority": 100, "sort_order": 3},
        {"name": "org_map", "layer": "always", "content": "Organizational capability map.", "tags": [], "priority": 90, "sort_order": 16},
        {"name": "embedded_iot", "layer": "domain", "content": "Embedded IoT framework.", "tags": ["plc", "firmware", "sensor"], "priority": 50, "sort_order": 17},
        {"name": "business_apps", "layer": "domain", "content": "Business application suite.", "tags": ["erp", "crm", "warehouse"], "priority": 50, "sort_order": 18},
        {"name": "ai_ops", "layer": "domain", "content": "AI/ML/LLMOps framework.", "tags": ["llm", "agent", "rag"], "priority": 50, "sort_order": 19},
    ]


@pytest.fixture
def sample_modes():
    return [
        {"name": "analysis", "prompt_text": "Focus on objective analysis, gaps, risks."},
        {"name": "implementation", "prompt_text": "Produce concrete steps, APIs, schemas."},
    ]


def test_compile_loads_core_and_always(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")
    assert "identity" in result["modules_loaded"]
    assert "reasoning" in result["modules_loaded"]
    assert "execution" in result["modules_loaded"]
    assert "output" in result["modules_loaded"]
    assert "org_map" in result["modules_loaded"]
    assert "embedded_iot" not in result["modules_loaded"]


def test_compile_loads_matching_domain(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Configure the PLC sensor array", mode=None, doc_context="")
    assert "embedded_iot" in result["modules_loaded"]
    assert "business_apps" not in result["modules_loaded"]


def test_compile_with_mode(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Review this", mode="analysis", doc_context="")
    assert "Focus on objective analysis" in result["system_prompt"]


def test_compile_with_doc_context(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Summarize this", mode=None, doc_context="Document content here.")
    assert "Document content here." in result["system_prompt"]


def test_compile_includes_safety_wrapper(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")
    assert "operating rules" in result["system_prompt"].lower() or "prompt pack" in result["system_prompt"].lower()


def test_compile_returns_debug_info(sample_modules, sample_modes):
    compiler = PromptCompiler(modules=sample_modules, modes=sample_modes, model_context_limit=128000, condensed_core=None)
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")
    assert "total_tokens" in result
    assert "modules_loaded" in result
    assert "system_prompt" in result
    assert isinstance(result["total_tokens"], int)
