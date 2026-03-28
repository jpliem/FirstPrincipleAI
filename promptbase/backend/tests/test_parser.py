import tempfile
from pathlib import Path

import pytest

from app.documents.parser import parse_document


def test_parse_txt():
    with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
        f.write("Hello world, this is a test document.")
        f.flush()
        result = parse_document(f.name, "text/plain")
    assert "Hello world" in result


def test_parse_csv():
    with tempfile.NamedTemporaryFile(suffix=".csv", mode="w", delete=False) as f:
        f.write("name,value\nfoo,1\nbar,2\n")
        f.flush()
        result = parse_document(f.name, "text/csv")
    assert "foo" in result
    assert "bar" in result


def test_parse_unknown_type_raises():
    with pytest.raises(ValueError, match="Unsupported"):
        parse_document("/tmp/fake.xyz", "application/xyz")
