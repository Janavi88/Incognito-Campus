"""Search service for Incognito Campus: a small HTTP API around embed_posts.py.

The Node server calls this to (1) embed a post when it is created, (2) run semantic
search and (3) check for duplicates while a student is writing a doubt.

Run (from the repo root):
    pip install flask psycopg2-binary pgvector sentence-transformers
    $env:DB_PORT = "5433"
    python search_service.py                 # listens on http://localhost:8001

No model download / quick test only:   $env:EMBEDDER = "fake"   (dev stand-in, NOT real semantics)
Settings: DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD (see embed_posts.py), SEARCH_PORT,
          SEARCH_MIN_SIMILARITY (default 0.4), DUPLICATE_THRESHOLD (default 0.85).
"""
import hashlib
import logging
import os
import re

import numpy as np
from flask import Flask, jsonify, request

import embed_posts as ep

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("search_service")

SEARCH_MIN_SIMILARITY = float(os.getenv("SEARCH_MIN_SIMILARITY", "0.4"))
DUPLICATE_THRESHOLD = float(os.getenv("DUPLICATE_THRESHOLD", str(ep.DUPLICATE_THRESHOLD)))

app = Flask(__name__)
_model = None


class FakeModel:
    """Development stand-in: hashes words into a 384-dim vector. Texts that share words come
    out similar, which is enough to test the wiring without downloading the real model.
    Its vectors are stored under their own model name so they are never mistaken for real ones."""
    incognito_name = "fake-hash-dev"

    def encode(self, text):
        vec = np.zeros(384, dtype=np.float32)
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            vec[int(hashlib.md5(word.encode()).hexdigest(), 16) % 384] += 1.0
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec


def get_model():
    global _model
    if _model is None:
        if os.getenv("EMBEDDER", "real").lower() == "fake":
            log.warning("Using the FAKE dev embedder. Do not use it for the real demo.")
            _model = FakeModel()
        else:
            _model = ep.load_model()
    return _model


def as_json(rows):
    return [{"post_id": str(r[0]), "title": r[1], "status": r[2],
             "similarity": round(float(r[3]), 4), "subject_code": r[4]} for r in rows]


def bad(message, code=400):
    return jsonify({"error": message}), code


@app.get("/health")
def health():
    conn = ep.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM post p LEFT JOIN post_embeddings e ON e.post_id = p.post_id "
                        "WHERE e.embedding IS NULL AND p.merged_into IS NULL")
            missing = cur.fetchone()[0]
    finally:
        conn.close()
    return jsonify({"status": "ok", "model": ep.name_of(get_model()), "posts_missing_embedding": missing})


@app.post("/embed")
def embed():
    post_id = (request.get_json(silent=True) or {}).get("postId")
    if not isinstance(post_id, str) or not post_id:
        return bad("postId is required")
    conn = ep.connect()
    try:
        found = ep.embed_one(conn, get_model(), post_id)
    except Exception as exc:                       # bad uuid, db error, model error
        log.exception("embed failed for %s", post_id)
        return bad(f"could not embed: {exc.__class__.__name__}", 500)
    finally:
        conn.close()
    return (jsonify({"embedded": True}) if found else bad("post not found", 404))


@app.post("/embed-missing")
def embed_missing():
    """The retry: embed every post that has no embedding yet (rebuild=true re-embeds all)."""
    rebuild = bool((request.get_json(silent=True) or {}).get("rebuild"))
    conn = ep.connect()
    try:
        done, failed = ep.embed_posts(conn, get_model(), rebuild=rebuild)
    finally:
        conn.close()
    return jsonify({"embedded": done, "failed": failed})


@app.post("/search")
def search():
    body = request.get_json(silent=True) or {}
    query = body.get("query")
    if not isinstance(query, str) or len(query.strip()) < 3:
        return bad("query must be at least 3 characters")
    limit = max(1, min(int(body.get("limit", 10)), 25))
    conn = ep.connect()
    try:
        rows = ep.search_similar(conn, get_model(), query.strip(), limit=limit,
                                 subject_id=body.get("subjectId"),
                                 min_similarity=float(body.get("minSimilarity", SEARCH_MIN_SIMILARITY)),
                                 exclude_post_id=body.get("excludePostId"))
    finally:
        conn.close()
    return jsonify({"results": as_json(rows)})


@app.post("/duplicates")
def duplicates():
    body = request.get_json(silent=True) or {}
    title, text = body.get("title"), body.get("body", "")
    if not isinstance(title, str) or not title.strip():
        return bad("title is required")
    conn = ep.connect()
    try:
        rows = ep.find_duplicates(conn, get_model(), title.strip(), str(text).strip(),
                                  threshold=DUPLICATE_THRESHOLD, subject_id=body.get("subjectId"))
    finally:
        conn.close()
    return jsonify({"duplicates": as_json(rows), "threshold": DUPLICATE_THRESHOLD})


if __name__ == "__main__":
    get_model()          # load now, so the first request is not slow
    app.run(host="127.0.0.1", port=int(os.getenv("SEARCH_PORT", "8001")))
