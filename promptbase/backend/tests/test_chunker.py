from app.documents.chunker import chunk_text


def test_chunk_text_basic():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = chunk_text(text, chunk_size=20, overlap=5)
    assert len(chunks) >= 2
    assert all(isinstance(c, str) for c in chunks)
    assert all(len(c) > 0 for c in chunks)


def test_chunk_text_small_fits_one():
    text = "Short text."
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) == 1
    assert chunks[0] == "Short text."


def test_chunk_text_preserves_content():
    text = "Word " * 200
    chunks = chunk_text(text, chunk_size=200, overlap=50)
    reassembled = " ".join(chunks)
    assert reassembled.count("Word") >= 200
