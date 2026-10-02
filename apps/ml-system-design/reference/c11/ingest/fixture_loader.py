"""Carga el corpus FICTICIO de eval/fixtures/corpus.json por el camino real de la ingesta (tests, eval y demo).

Cada documento pasa por lo mismo que en producción: ACL de la fuente → acl.py → chunker.py → incremental.py →
índice. Así los tests de retrieval, de la evaluación y del servicio prueban la cadena entera, no un índice armado
a mano que podría tener ACLs que la ingesta nunca produciría.
"""

from __future__ import annotations  # anotaciones como texto

import json  # el fixture
from collections.abc import Callable  # reloj inyectable
from pathlib import Path  # rutas

from acl import AclResult, Grants, IdentitySnapshot, confluence_acl, drive_acl, jira_acl  # normalizadores
from chunker import Chunker, from_markdown  # markdown mínimo → documento → chunks
from incremental import ChangeEvent, InMemoryState, Ingestor, Outcome  # aplicar eventos

DEFAULT_CORPUS = Path(__file__).resolve().parent.parent / "eval" / "fixtures" / "corpus.json"


def normalize_acl(spec: dict, company_domain: str) -> AclResult:
    kind = spec["kind"]
    if kind == "confluence":
        space = Grants(tuple(spec["space"].get("users", ())), tuple(spec["space"].get("groups", ())))
        chain = [Grants(tuple(r.get("users", ())), tuple(r.get("groups", ()))) for r in spec.get("restrictions", ())]
        return confluence_acl(space, chain)
    if kind == "drive":
        return drive_acl(spec["permissions"], company_domain)
    if kind == "jira":
        browse = [tuple(g) for g in spec["browse"]]
        security = [tuple(g) for g in spec["security"]] if "security" in spec else None
        return jira_acl(spec["project"], browse, company_domain, security,
                        spec.get("reporter"), spec.get("assignee"))
    raise ValueError(f"tipo de ACL desconocido: {kind}")


def load_identity(data: dict, taken_at: float) -> IdentitySnapshot:
    ident = data["identity"]
    return IdentitySnapshot(
        taken_at=taken_at,
        company_domain=data["company_domain"],
        user_groups={u: frozenset(g) for u, g in ident["user_groups"].items()},
        group_parents={g: frozenset(p) for g, p in ident.get("group_parents", {}).items()},
        role_members={r: frozenset(m) for r, m in ident.get("role_members", {}).items()},
    )


def ingest_corpus(ingestor: Ingestor, path: Path = DEFAULT_CORPUS, observed_at: float = 1_790_000_000.0
                  ) -> tuple[dict, dict[str, Outcome]]:
    """Aplica cada documento del fixture como un ChangeEvent. Devuelve (el JSON, {doc_id: Outcome})."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    outcomes: dict[str, Outcome] = {}
    for d in data["documents"]:
        ev = ChangeEvent(
            source=d["source"], doc_id=d["doc_id"], version=int(d["version"]), observed_at=observed_at,
            document=from_markdown(d["doc_id"], d["title"], d["markdown"]),
            acl=normalize_acl(d["acl"], data["company_domain"]),
            url=d["url"], updated_at=d["updated_at"],
        )
        outcomes[d["doc_id"]] = ingestor.apply(ev)
    return data, outcomes


def build_demo(path: Path = DEFAULT_CORPUS, clock: Callable[[], float] | None = None):
    """Índice en memoria + embedder falso + foto del IdP, listos para HybridRetriever. Para tests y la demo."""
    from fakes import HashingEmbedder  # import local: ingest/ no depende de retrieval/ salvo para esta demo
    from hybrid import InMemoryIndex

    index = InMemoryIndex()
    embedder = HashingEmbedder()
    ingestor = Ingestor(Chunker(), embedder, index, InMemoryState(), clock=clock or (lambda: 1_790_000_060.0))
    data, outcomes = ingest_corpus(ingestor, path)
    return index, embedder, data, outcomes
