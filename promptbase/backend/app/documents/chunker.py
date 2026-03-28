from app.compiler.budget import count_tokens_approx


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    if len(text) <= chunk_size:
        return [text]

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk = ""

    for para in paragraphs:
        if len(current_chunk) + len(para) + 2 <= chunk_size:
            current_chunk = (current_chunk + "\n\n" + para).strip()
        else:
            if current_chunk:
                chunks.append(current_chunk)
            if len(para) > chunk_size:
                sub_chunks = _hard_split(para, chunk_size, overlap)
                chunks.extend(sub_chunks)
                current_chunk = ""
            else:
                if chunks:
                    overlap_text = current_chunk[-overlap:] if len(current_chunk) > overlap else ""
                    current_chunk = (overlap_text + " " + para).strip()
                else:
                    current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _hard_split(text: str, chunk_size: int, overlap: int) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk.strip())
        start = end - overlap
    return [c for c in chunks if c]


def count_chunk_tokens(chunks: list[str]) -> list[int]:
    return [count_tokens_approx(c) for c in chunks]
