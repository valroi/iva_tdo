"""RAG-слой FEED: локальные эмбеддинги (bge-m3 через fastembed) + Qdrant.

Тяжёлые зависимости (fastembed, qdrant-client) грузятся ЛЕНИВО — импорт модуля
не тянет ONNX-модели. Если они недоступны/не настроены — функции бросают
RagUnavailable, а вызывающий код уходит в keyword-фолбэк.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import FeedDocument

logger = logging.getLogger("feed_rag")
settings = get_settings()

_NAMESPACE = uuid.UUID("a3f1c2e4-0000-4000-8000-feed00000000")


class RagUnavailable(RuntimeError):
    """RAG-стек не готов (нет зависимостей / Qdrant недоступен)."""


@dataclass
class Hit:
    doc_id: int
    doc_number: str
    title: str | None
    discipline: str | None
    text: str
    score: float


# --------------------------------------------------------------- ленивые ресурсы
_embedder = None
_reranker = None
_qdrant = None
_dim: int | None = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        try:
            from fastembed import TextEmbedding
        except Exception as exc:  # noqa: BLE001
            raise RagUnavailable(f"fastembed не установлен: {exc}") from exc
        logger.info("Загружаю embed-модель %s …", settings.rag_embed_model)
        _embedder = TextEmbedding(model_name=settings.rag_embed_model)
    return _embedder


def _get_reranker():
    global _reranker
    if not settings.rag_rerank:
        return None
    if _reranker is None:
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            _reranker = TextCrossEncoder(model_name="Xenova/bge-reranker-v2-m3")
        except Exception as exc:  # noqa: BLE001 — реранк необязателен
            logger.warning("Реранкер недоступен, иду без него: %s", exc)
            _reranker = None
    return _reranker


def _embed(texts: list[str]) -> list[list[float]]:
    vecs = [v.tolist() for v in _get_embedder().embed(texts)]
    global _dim
    if vecs and _dim is None:
        _dim = len(vecs[0])
    return vecs


def embed_query(query: str) -> list[float]:
    return _embed([query])[0]


def _get_qdrant():
    global _qdrant
    if _qdrant is None:
        try:
            from qdrant_client import QdrantClient
        except Exception as exc:  # noqa: BLE001
            raise RagUnavailable(f"qdrant-client не установлен: {exc}") from exc
        if settings.qdrant_url == ":memory:":
            _qdrant = QdrantClient(location=":memory:")  # эфемерно (тесты/dev)
        else:
            _qdrant = QdrantClient(url=settings.qdrant_url, timeout=30)
    return _qdrant


def _ensure_collection(dim: int) -> None:
    from qdrant_client import models

    client = _get_qdrant()
    if client.collection_exists(settings.rag_collection):
        return
    client.create_collection(
        collection_name=settings.rag_collection,
        vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE),
    )
    client.create_payload_index(
        settings.rag_collection, field_name="project_id",
        field_schema=models.PayloadSchemaType.INTEGER,
    )
    client.create_payload_index(
        settings.rag_collection, field_name="doc_id",
        field_schema=models.PayloadSchemaType.INTEGER,
    )


# --------------------------------------------------------------- чанкинг
def chunk_text(text: str) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text or "").strip()
    if not text:
        return []
    size, overlap = settings.rag_chunk_chars, settings.rag_chunk_overlap
    chunks, i = [], 0
    while i < len(text):
        chunks.append(text[i : i + size])
        i += size - overlap
    return chunks


# --------------------------------------------------------------- индексация
def _point_id(doc_id: int, idx: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{doc_id}:{idx}"))


def index_document(doc: FeedDocument) -> int:
    """Переиндексировать один документ (удалить старые точки → залить новые).
    Возвращает число чанков."""
    from qdrant_client import models

    body = " ".join(filter(None, [doc.doc_number, doc.title_en, doc.title_ru, doc.search_text or ""]))
    chunks = chunk_text(body)
    client = _get_qdrant()
    # Удаляем прежние точки документа (по payload doc_id).
    try:
        client.delete(
            settings.rag_collection,
            points_selector=models.FilterSelector(filter=models.Filter(
                must=[models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc.id))]
            )),
        )
    except Exception:  # noqa: BLE001 — коллекции может ещё не быть
        pass
    if not chunks:
        return 0
    vecs = _embed(chunks)
    _ensure_collection(len(vecs[0]))
    points = [
        models.PointStruct(
            id=_point_id(doc.id, i),
            vector=v,
            payload={
                "doc_id": doc.id,
                "project_id": doc.project_id,
                "doc_number": doc.doc_number,
                "title": doc.title_en or doc.title_ru,
                "discipline": doc.discipline_code,
                "text": ch,
            },
        )
        for i, (ch, v) in enumerate(zip(chunks, vecs))
    ]
    client.upsert(settings.rag_collection, points=points)
    return len(points)


def reindex_all(db: Session, project_id: int | None = None) -> dict[str, int]:
    q = db.query(FeedDocument)
    if project_id is not None:
        q = q.filter(FeedDocument.project_id == project_id)
    docs = q.all()
    total_docs = total_chunks = 0
    for doc in docs:
        try:
            n = index_document(doc)
            total_chunks += n
            total_docs += 1
        except RagUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 — один битый док не валит реиндекс
            logger.warning("Индексация дока %s провалилась: %s", doc.id, exc)
    return {"documents": total_docs, "chunks": total_chunks}


# --------------------------------------------------------------- поиск
def search(query: str, project_id: int | None, top_k: int | None = None) -> list[Hit]:
    from qdrant_client import models

    client = _get_qdrant()
    if not client.collection_exists(settings.rag_collection):
        return []
    qvec = embed_query(query)
    flt = None
    if project_id is not None:
        flt = models.Filter(must=[models.FieldCondition(
            key="project_id", match=models.MatchValue(value=project_id))])
    res = client.query_points(
        settings.rag_collection, query=qvec, limit=top_k or settings.rag_top_k,
        query_filter=flt, with_payload=True,
    ).points
    hits = [
        Hit(
            doc_id=p.payload.get("doc_id"),
            doc_number=p.payload.get("doc_number", ""),
            title=p.payload.get("title"),
            discipline=p.payload.get("discipline"),
            text=p.payload.get("text", ""),
            score=float(p.score),
        )
        for p in res
    ]
    return _rerank(query, hits)


def _rerank(query: str, hits: list[Hit]) -> list[Hit]:
    reranker = _get_reranker()
    if not reranker or not hits:
        return hits[: settings.rag_top_n]
    try:
        scores = list(reranker.rerank(query, [h.text for h in hits]))
        order = sorted(range(len(hits)), key=lambda i: -scores[i])
        return [hits[i] for i in order[: settings.rag_top_n]]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Реранк упал, отдаю векторный порядок: %s", exc)
        return hits[: settings.rag_top_n]


def rag_ready() -> bool:
    """Быстрая проверка: установлены ли зависимости (без загрузки моделей)."""
    try:
        import fastembed  # noqa: F401
        import qdrant_client  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False
