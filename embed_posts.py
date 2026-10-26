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

MODEL_NAME = "all-MiniLM-L6-v2"      # 384 dimensions, matches vector(384)
DUPLICATE_THRESHOLD = 0.85           # cosine similarity; tune between 0.80 and 0.90

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("embed")


def load_model():
    """Load the real embedding model (imported here so other code can use this module without it)."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)


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


def name_of(model):
    """Name stored next to each vector. A dev stand-in model sets its own name so its
    vectors can never be mistaken for real ones."""
    return getattr(model, "incognito_name", MODEL_NAME)


def save_embedding(conn, model, post_id, title, body):
    """Embed one post and upsert its row. Caller commits."""
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
        """, (str(post_id), vec, name_of(model)))


def embed_one(conn, model, post_id):
    """Embed a single post by id. Returns False if the post does not exist."""
    with conn.cursor() as cur:
        cur.execute("SELECT title, body FROM post WHERE post_id = %s", (str(post_id),))
        row = cur.fetchone()
    if row is None:
        return False
    try:
        save_embedding(conn, model, post_id, row[0], row[1])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return True


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
            save_embedding(conn, model, post_id, title, body)
            conn.commit()
            done += 1
        except Exception:
            conn.rollback()
            failed += 1
            log.exception("Embedding failed for post %s (will retry next run)", post_id)
    log.info("Embedded %d post(s), %d failed", done, failed)
    return done, failed


def search_similar(conn, model, query, limit=5, subject_id=None,
                   min_similarity=0.0, exclude_post_id=None):
    """Top-N most similar posts, best first. Merged duplicates are excluded.
    Rows: (post_id, title, status, similarity, subject_code)."""
    vec = model.encode(query)
    exclude = str(exclude_post_id) if exclude_post_id else None
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.post_id, p.title, p.status,
                   1 - (e.embedding <=> %s) AS similarity,
                   s.subject_code
            FROM post_embeddings e
            JOIN post p ON p.post_id = e.post_id
            JOIN subject s ON s.subject_id = p.subject_id
            WHERE e.embedding IS NOT NULL
              AND p.merged_into IS NULL
              AND (%s::text IS NULL OR p.subject_id = %s)
              AND (%s::uuid IS NULL OR p.post_id <> %s::uuid)
              AND 1 - (e.embedding <=> %s) >= %s
            ORDER BY e.embedding <=> %s
            LIMIT %s
        """, (vec, subject_id, subject_id, exclude, exclude, vec, min_similarity, vec, limit))
        return cur.fetchall()


def find_duplicates(conn, model, title, body, threshold=DUPLICATE_THRESHOLD, subject_id=None, limit=5):
    """Call this while a student is writing a new post."""
    return search_similar(conn, model, post_text(title, body), limit=limit,
                          subject_id=subject_id, min_similarity=threshold)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="re-embed every post")
    args = ap.parse_args()

    model = load_model()
    conn = connect()
    embed_posts(conn, model, rebuild=args.rebuild)

    print("\nSearch: 'BCNF vs 3NF difference'")
    for post_id, title, status, sim, _subject in search_similar(conn, model, "BCNF vs 3NF difference", min_similarity=0.4):
        print(f"  {sim:.3f}  [{status}]  {title}")

    print("\nDuplicate check for a new post:")
    dups = find_duplicates(conn, model, "Is 3NF always BCNF?", "Does 3NF imply BCNF for every relation?")
    for post_id, title, status, sim, _subject in dups:
        print(f"  {sim:.3f}  {title}")
    if not dups:
        print("  none above threshold")
    conn.close()