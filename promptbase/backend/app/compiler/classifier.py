DEFAULT_DOMAIN_MODULES = [
    {
        "domain_key": "embedded_iot",
        "tags": ["plc", "firmware", "sensor", "iot", "embedded", "modbus", "snmp", "scada", "electronics", "microcontroller"],
    },
    {
        "domain_key": "business_apps",
        "tags": ["erp", "crm", "ppc", "warehouse", "qc", "production", "purchasing", "inventory", "logistics", "procurement"],
    },
    {
        "domain_key": "ai_ops",
        "tags": ["llm", "agent", "mlops", "ai", "rag", "eval", "vision", "embedding", "fine-tune", "prompt engineering"],
    },
    {
        "domain_key": "platform",
        "tags": ["cloud", "devops", "deploy", "docker", "kubernetes", "security", "ci/cd", "terraform", "aws", "azure", "gcp"],
    },
    {
        "domain_key": "digital_thread",
        "tags": ["bom", "config", "revision", "traceability", "digital thread", "configuration", "lifecycle", "as-built"],
    },
    {
        "domain_key": "reference_patterns",
        "tags": ["solution design", "architecture", "patterns", "reference architecture", "system design", "integration pattern"],
    },
]

MODE_KEYWORDS = {
    "analysis": ["analyze", "analysis", "review", "assess", "evaluate", "gap", "audit", "compare", "investigate"],
    "implementation": ["implement", "build", "create", "develop", "code", "write", "add feature", "set up"],
    "solution_design": ["design", "architect", "propose", "solution", "blueprint", "plan system"],
    "tender_response": ["tender", "rfp", "rfq", "proposal", "bid", "quotation", "compliance matrix"],
    "architecture_review": ["architecture review", "tech debt", "refactor assessment", "system review"],
    "business_process": ["process", "workflow", "procedure", "sop", "operating model"],
}


def classify_request(text: str, custom_modules: list[dict] | None = None) -> set[str]:
    text_lower = text.lower()
    domains = set()

    modules = DEFAULT_DOMAIN_MODULES + (custom_modules or [])

    for module in modules:
        for tag in module["tags"]:
            if tag.lower() in text_lower:
                domains.add(module["domain_key"])
                break

    return domains


def detect_mode(text: str) -> str | None:
    text_lower = text.lower()

    scores: dict[str, int] = {}
    for mode, keywords in MODE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                scores[mode] = scores.get(mode, 0) + 1

    if not scores:
        return None

    return max(scores, key=scores.get)
