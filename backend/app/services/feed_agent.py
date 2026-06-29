"""LangGraph-агент FEED: единственная функция — ответ на вопрос по
документации с опорой на RAG-поиск (Qdrant + bge-m3) и LLM на OpenRouter.

Граф: retrieve → generate. retrieve тянет и реранкует чанки (feed_rag.search),
generate просит Qwen ответить ТОЛЬКО по контексту и перечислить шифры-источники.
"""

from __future__ import annotations

import logging
from typing import List, Optional, TypedDict

from app.config import get_settings
from app.services import feed_rag

logger = logging.getLogger("feed_agent")
settings = get_settings()

_SYSTEM = (
    "Ты ассистент по проектной документации стадии FEED. Отвечай на языке"
    " вопроса, кратко и по делу. Используй ТОЛЬКО предоставленные фрагменты"
    " документов. Если ответа в них нет — честно скажи, что не нашёл."
    " В конце перечисли шифры документов-источников."
)


class AgentState(TypedDict, total=False):
    query: str
    project_id: Optional[int]
    hits: List
    answer: str
    sources: List


def _node_retrieve(state: AgentState) -> AgentState:
    hits = feed_rag.search(state["query"], state.get("project_id"))
    return {"hits": hits}


def _llm_answer(question: str, context: str) -> str:
    from openai import OpenAI

    client = OpenAI(base_url=settings.ai_api_base_url, api_key=settings.ai_api_key)
    resp = client.chat.completions.create(
        model=settings.agent_model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Фрагменты документов:\n{context}\n\nВопрос: {question}"},
        ],
    )
    return resp.choices[0].message.content or ""


def _node_generate(state: AgentState) -> AgentState:
    hits = state.get("hits") or []
    if not hits:
        return {"answer": "По документации ничего не найдено. Уточните формулировку.", "sources": []}

    # Контекст: топ-фрагменты. Источники — уникальные документы.
    parts, seen, sources = [], set(), []
    for h in hits:
        parts.append(f"=== {h.doc_number} {h.title or ''} ===\n{h.text}")
        if h.doc_id not in seen:
            seen.add(h.doc_id)
            sources.append({
                "document_id": h.doc_id,
                "doc_number": h.doc_number,
                "title_en": h.title,
                "title_ru": None,
                "discipline_code": h.discipline or "",
                "latest_rev": None,
                "snippet": (h.text[:200] + "…") if h.text else None,
            })
    context = "\n\n".join(parts)[:24000]
    answer = _llm_answer(state["query"], context)
    return {"answer": answer, "sources": sources}


_graph = None


def _get_graph():
    global _graph
    if _graph is None:
        from langgraph.graph import END, StateGraph

        g = StateGraph(AgentState)
        g.add_node("retrieve", _node_retrieve)
        g.add_node("generate", _node_generate)
        g.set_entry_point("retrieve")
        g.add_edge("retrieve", "generate")
        g.add_edge("generate", END)
        _graph = g.compile()
    return _graph


def answer_question(query: str, project_id: int | None = None) -> dict:
    """Точка входа агента. Возвращает {answer, mode, sources}.
    Бросает feed_rag.RagUnavailable, если RAG-стек не готов — выше keyword-фолбэк."""
    out = _get_graph().invoke({"query": query, "project_id": project_id})
    return {"answer": out.get("answer", ""), "mode": "agent", "sources": out.get("sources", [])}
