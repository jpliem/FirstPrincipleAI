import pytest
from app.chat.think_parser import ThinkTagParser


def test_no_thinking_tags():
    """Plain text passes through as text events."""
    parser = ThinkTagParser()
    tokens = ["Hello", " world", "!"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    assert events == [("text", "Hello"), ("text", " world"), ("text", "!")]


def test_complete_think_block():
    """A complete <think>...</think> block yields thinking events."""
    parser = ThinkTagParser()
    tokens = ["<think>", "I need to reason", "</think>", "Here is the answer"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    types = [e[0] for e in events]
    content = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert "thinking" in types
    assert "text" in types
    assert content == "I need to reason"
    assert text == "Here is the answer"


def test_think_tag_split_across_chunks():
    """<think> tag split across multiple token chunks."""
    parser = ThinkTagParser()
    tokens = ["<thi", "nk>", "reasoning here", "</thi", "nk>", "response"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert thinking == "reasoning here"
    assert text == "response"


def test_think_tag_char_by_char():
    """Tags arriving one character at a time."""
    parser = ThinkTagParser()
    full = "<think>step by step</think>answer"
    events = []
    for ch in full:
        events.extend(parser.feed(ch))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert thinking == "step by step"
    assert text == "answer"


def test_angle_bracket_not_a_tag():
    """A '<' that doesn't start <think> gets flushed as text."""
    parser = ThinkTagParser()
    tokens = ["Use <b>bold</b> text"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    text = "".join(e[1] for e in events if e[0] == "text")
    assert text == "Use <b>bold</b> text"


def test_accumulated_content():
    """Parser accumulates thinking and text content for DB storage."""
    parser = ThinkTagParser()
    tokens = ["<think>", "deep thought", "</think>", "final answer"]
    for token in tokens:
        parser.feed(token)
    parser.flush()
    assert parser.thinking_content == "deep thought"
    assert parser.text_content == "final answer"


def test_no_thinking_accumulated_content():
    """When there are no think tags, text_content has everything."""
    parser = ThinkTagParser()
    tokens = ["just", " plain", " text"]
    for token in tokens:
        parser.feed(token)
    parser.flush()
    assert parser.thinking_content == ""
    assert parser.text_content == "just plain text"


def test_think_at_start_with_newlines():
    """Think block at start with newlines inside and after."""
    parser = ThinkTagParser()
    tokens = ["<think>\n", "line1\nline2\n", "</think>\n", "response"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert "line1\nline2" in thinking
    assert "response" in text
