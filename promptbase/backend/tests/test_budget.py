from app.compiler.budget import TokenBudget, count_tokens_approx


def test_count_tokens_approx():
    text = "Hello world this is a test"
    count = count_tokens_approx(text)
    assert 4 <= count <= 10


def test_budget_fits():
    budget = TokenBudget(model_context_limit=128000)
    budget.reserve_for_response(4096)
    budget.reserve_for_history(2000)
    budget.add_section("core", "A " * 5000, priority=100)
    assert budget.fits()
    assert budget.remaining() > 100000


def test_budget_overflow_trims_lowest_priority():
    budget = TokenBudget(model_context_limit=1000)
    budget.reserve_for_response(200)
    budget.reserve_for_history(200)
    budget.add_section("core", "word " * 400, priority=100)
    budget.add_section("domain_a", "word " * 300, priority=50)
    budget.add_section("domain_b", "word " * 100, priority=80)

    result = budget.compile()
    assert "core" in result["included"]
    assert "domain_b" in result["included"]


def test_budget_use_condensed_core():
    budget = TokenBudget(model_context_limit=8000)
    budget.reserve_for_response(2000)
    budget.reserve_for_history(1000)

    full_core = "word " * 6000
    condensed = "word " * 1500

    result = budget.add_core_with_fallback(full_core, condensed)
    assert result == "condensed"


def test_budget_use_full_core():
    budget = TokenBudget(model_context_limit=128000)
    budget.reserve_for_response(4096)
    budget.reserve_for_history(2000)

    full_core = "word " * 6000
    condensed = "word " * 1500

    result = budget.add_core_with_fallback(full_core, condensed)
    assert result == "full"
