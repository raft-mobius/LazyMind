"""Text chunking with overlap for document processing."""
from dataclasses import dataclass


@dataclass
class Chunk:
    index: int
    content: str
    token_count: int


def chunk_text(
    text: str,
    chunk_size: int = 512,
    chunk_overlap: int = 64,
    separator: str = "\n\n",
) -> list[Chunk]:
    """Split text into overlapping chunks.

    Uses paragraph boundaries when possible, falls back to character splitting.
    """
    if not text.strip():
        return []

    paragraphs = text.split(separator)
    chunks: list[Chunk] = []
    current_chunk: list[str] = []
    current_length = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        para_len = len(para)

        if current_length + para_len > chunk_size and current_chunk:
            chunk_text_content = separator.join(current_chunk)
            chunks.append(Chunk(
                index=len(chunks),
                content=chunk_text_content,
                token_count=_estimate_tokens(chunk_text_content),
            ))

            # Keep overlap
            overlap_chars = 0
            overlap_parts: list[str] = []
            for p in reversed(current_chunk):
                if overlap_chars + len(p) > chunk_overlap:
                    break
                overlap_parts.insert(0, p)
                overlap_chars += len(p)

            current_chunk = overlap_parts
            current_length = overlap_chars

        current_chunk.append(para)
        current_length += para_len

    if current_chunk:
        chunk_text_content = separator.join(current_chunk)
        chunks.append(Chunk(
            index=len(chunks),
            content=chunk_text_content,
            token_count=_estimate_tokens(chunk_text_content),
        ))

    # Handle case where a single paragraph exceeds chunk_size
    final_chunks: list[Chunk] = []
    for chunk in chunks:
        if len(chunk.content) > chunk_size * 2:
            sub_chunks = _force_split(chunk.content, chunk_size, chunk_overlap, len(final_chunks))
            final_chunks.extend(sub_chunks)
        else:
            chunk.index = len(final_chunks)
            final_chunks.append(chunk)

    return final_chunks


def _force_split(text: str, chunk_size: int, overlap: int, start_index: int) -> list[Chunk]:
    """Force-split text that's too long for paragraph-based chunking."""
    chunks: list[Chunk] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        content = text[start:end]
        chunks.append(Chunk(
            index=start_index + len(chunks),
            content=content,
            token_count=_estimate_tokens(content),
        ))
        start = end - overlap if end < len(text) else end
    return chunks


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~1.5 chars per token for Chinese, ~4 chars per token for English."""
    chinese_chars = sum(1 for c in text if '一' <= c <= '鿿')
    other_chars = len(text) - chinese_chars
    return int(chinese_chars / 1.5 + other_chars / 4)
