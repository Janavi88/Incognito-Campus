"""Embedding + semantic search for Incognito Campus.

Usage (PowerShell):
    python embed_posts.py              # embed posts that have no embedding yet
    python embed_posts.py --rebuild    # re-embed EVERYTHING (replaces seed placeholders)

Connection settings come from env vars (defaults match the Docker command):
    DB_HOST=localhost DB_PORT=5432 DB_NAME=incognito_campus DB_USER=postgres DB_PASSWORD=postgres
    PowerShell example for port 5433:  $env:DB_PORT = "5433"
"""
import argparse
import logging
import os

import psycopg2
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"      # 384 dimensions, matches vector(384)
DUPLICATE_THRESHOLD = 0.85           # cosine similarity; tune between 0.80 and 0.90

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("embed")


def connect():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "incognito_campus"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
    )
    register_vector(conn)
    return conn


def post_text(title, body):
    return f"{title}. {body}"


def embed_posts(conn, model, rebuild=False):
    """Embed posts missing an embedding (or all posts if rebuild=True).

    Each post is committed on its own, so one failure never blocks the rest.
    A failed post simply stays 'missing' and is picked up on the next run (the retry).
    """
    where = "" if rebuild else "WHERE e.post_id IS NULL OR e.embedding IS NULL"
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT p.post_id, p.title, p.body
            FROM post p
            LEFT JOIN post_embeddings e ON e.post_id = p.post_id
            {where}
            ORDER BY p.created_at
        """)
        rows = cur.fetchall()

    done = failed = 0
    for post_id, title, body in rows:
        try:
            vec = model.encode(post_text(title, body))
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO post_embeddings
                        (post_id, embedding, embedding_model, embedding_updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (post_id) DO UPDATE
                    SET embedding = EXCLUDED.embedding,
                        embedding_model = EXCLUDED.embedding_model,
                        embedding_updated_at = EXCLUDED.embedding_updated_at
                """, (str(post_id), vec, MODEL_NAME))
            conn.commit()
            done += 1
        except Exception:
            conn.rollback()
            failed += 1
            log.exception("Embedding failed for post %s (will retry next run)", post_id)
    log.info("Embedded %d post(s), %d failed", done, failed)


def search_similar(conn, model, query, limit=5, subject_id=None):
    """Top-N most similar posts. Merged duplicates are excluded."""
    vec = model.encode(query)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.post_id, p.title, p.status,
                   1 - (e.embedding <=> %s) AS similarity
            FROM post_embeddings e
            JOIN post p ON p.post_id = e.post_id
            WHERE p.merged_into IS NULL
              AND (%s::text IS NULL OR p.subject_id = %s)
            ORDER BY e.embedding <=> %s
            LIMIT %s
        """, (vec, subject_id, subject_id, vec, limit))
        return cur.fetchall()


def find_duplicates(conn, model, title, body, threshold=DUPLICATE_THRESHOLD):
    """Call this while a student is writing a new post."""
    hits = search_similar(conn, model, post_text(title, body), limit=5)
    return [h for h in hits if h[3] >= threshold]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="re-embed every post")
    args = ap.parse_args()

    model = SentenceTransformer(MODEL_NAME)
    conn = connect()
    embed_posts(conn, model, rebuild=args.rebuild)

    print("\nSearch: 'BCNF vs 3NF difference'")
    for post_id, title, status, sim in search_similar(conn, model, "BCNF vs 3NF difference"):
        print(f"  {sim:.3f}  [{status}]  {title}")

    print("\nDuplicate check for a new post:")
    dups = find_duplicates(conn, model, "Is 3NF always BCNF?", "Does 3NF imply BCNF for every relation?")
    for post_id, title, status, sim in dups:
        print(f"  {sim:.3f}  {title}")
    if not dups:
        print("  none above threshold")
    conn.close()