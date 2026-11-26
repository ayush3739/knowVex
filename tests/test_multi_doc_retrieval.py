from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import json
import pytest

from backend.agent.graphs import retriever_subagent
from backend.agent.graphs.state import create_retriever_state
from backend.agent import tools
from backend.core.retriever import RetrievalQuery


@pytest.mark.anyio
async def test_check_decomposition_scopes_target_document_ids(monkeypatch):
    captured_prompts = []

    async def fake_invoke(messages, task="router"):
        captured_prompts.append(messages[0]["content"])
        return json.dumps({
            "needs_decomposition": True,
            "queries": [
                {
                    "original_query": "notes on MLT",
                    "semantic_query": "Summary of MLT Unit 2.pdf",
                    "keyword_query": "MLT Unit 2 summary",
                    "target_document_ids": [101],
                },
                {
                    "original_query": "notes on CN",
                    "semantic_query": "Summary of Computer_Networks_Unit_2.pdf",
                    "keyword_query": "Computer Networks Unit 2",
                    "target_document_ids": [102, 9999],  # 9999 invalid, should be filtered out
                },
            ],
        })

    monkeypatch.setattr(retriever_subagent.llm, "invoke", fake_invoke)

    state = create_retriever_state(
        query="give short notes on each document",
        document_ids=[101, 102],
        document_names=["MLT Unit 2.pdf", "Computer_Networks_Unit_2.pdf"],
        db=object(),
    )

    out = await retriever_subagent.check_decomposition(state)
    assert out["needs_decomposition"] is True
    assert len(out["queries"]) == 2
    assert out["queries"][0].target_document_ids == [101]
    assert out["queries"][1].target_document_ids == [102]
    assert "id=101: MLT Unit 2.pdf" in captured_prompts[0]
    assert "id=102: Computer_Networks_Unit_2.pdf" in captured_prompts[0]


@pytest.mark.anyio
async def test_parallel_retrieval_passes_per_query_target_ids_and_scaled_top_n(monkeypatch):
    calls = []

    class FakeRetriever:
        def __init__(self, document_ids, db, db_lock=None):
            self.document_ids = list(document_ids)
            self.db = db
            self.db_lock = db_lock

        async def similarity_search(self, query, k=10):
            calls.append({
                "semantic": query.semantic_query,
                "document_ids": self.document_ids,
                "top_n": k,
            })
            doc_id = self.document_ids[0]
            return {
                "chunks": [
                    {
                        "chunk_id": f"chunk_{doc_id}_{i}",
                        "page_label": i + 1,
                        "source": f"doc_{doc_id}.pdf",
                        "text": f"content from doc {doc_id} chunk {i}",
                    }
                    for i in range(k)
                ],
                "confidence": 0.85,
                "used_vector_db": True,
            }

    monkeypatch.setattr(retriever_subagent, "Retriever", FakeRetriever)

    queries = [
        RetrievalQuery(
            original_query=f"doc {d}",
            semantic_query=f"Summary of doc {d}",
            keyword_query=f"doc {d}",
            target_document_ids=[d],
        )
        for d in [1, 2, 3, 4, 5, 6]
    ]

    state = {
        "query": "give short notes on each",
        "document_ids": [1, 2, 3, 4, 5, 6],
        "document_names": [f"doc_{d}.pdf" for d in [1, 2, 3, 4, 5, 6]],
        "db": object(),
        "queries": queries,
        "needs_decomposition": True,
    }

    out = await retriever_subagent.parallel_retrieval(state)

    # 6 queries, 30 // 6 = 5 chunks per doc => 30 distinct chunks across all 6 docs
    assert len(calls) == 6
    for idx, doc_id in enumerate([1, 2, 3, 4, 5, 6]):
        assert calls[idx]["document_ids"] == [doc_id]
        assert calls[idx]["top_n"] == 5

    assert len(out["reranked_chunks"]) == 30
    sources_returned = {c["source"] for c in out["reranked_chunks"]}
    assert sources_returned == {f"doc_{d}.pdf" for d in [1, 2, 3, 4, 5, 6]}


@pytest.mark.anyio
async def test_load_document_chunks_balances_across_documents():
    executed_queries = []

    class FakeResult:
        def __init__(self, doc_id):
            self._doc_id = doc_id

        def scalars(self):
            chunks = [
                SimpleNamespace(
                    chunk_id=f"c_{self._doc_id}_{i}",
                    page_number=i + 1,
                    source=f"doc_{self._doc_id}.pdf",
                    page_content=f"text {self._doc_id}-{i}",
                )
                for i in range(5)
            ]
            return SimpleNamespace(all=lambda: chunks)

    class FakeDB:
        async def execute(self, stmt):
            executed_queries.append(stmt)
            idx = len(executed_queries)
            return FakeResult(idx)

    chunks = await tools._load_document_chunks([10, 20, 30], FakeDB(), limit=15)
    assert len(executed_queries) == 3
    assert len(chunks) == 15
    assert {c["source"] for c in chunks} == {"doc_1.pdf", "doc_2.pdf", "doc_3.pdf"}
