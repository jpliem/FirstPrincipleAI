from app.compiler.classifier import classify_request, detect_mode


def test_classify_embedded_iot():
    domains = classify_request("We need to configure the PLC for the new sensor array")
    assert "embedded_iot" in domains


def test_classify_business_apps():
    domains = classify_request("Update the ERP warehouse module for QC integration")
    assert "business_apps" in domains


def test_classify_ai_ops():
    domains = classify_request("Set up the RAG pipeline with LLM evaluation")
    assert "ai_ops" in domains


def test_classify_platform():
    domains = classify_request("Deploy the service to Kubernetes with Docker")
    assert "platform" in domains


def test_classify_digital_thread():
    domains = classify_request("Update the BOM revision and traceability records")
    assert "digital_thread" in domains


def test_classify_reference_patterns():
    domains = classify_request("Design the solution architecture for the new system")
    assert "reference_patterns" in domains


def test_classify_multiple_domains():
    domains = classify_request("Deploy the AI agent to Kubernetes with Docker")
    assert "ai_ops" in domains
    assert "platform" in domains


def test_classify_no_match():
    domains = classify_request("Tell me a joke")
    assert len(domains) == 0


def test_classify_with_custom_modules():
    custom = [
        {"tags": ["solar", "inverter", "panel"], "domain_key": "solar_energy"},
    ]
    domains = classify_request("Install the solar panel inverter", custom_modules=custom)
    assert "solar_energy" in domains


def test_detect_mode_from_text():
    mode = detect_mode("Analyze the gaps in this tender specification")
    assert mode == "analysis"


def test_detect_mode_implementation():
    mode = detect_mode("Implement the API endpoint for user registration")
    assert mode == "implementation"


def test_detect_mode_none():
    mode = detect_mode("Tell me about the project")
    assert mode is None
