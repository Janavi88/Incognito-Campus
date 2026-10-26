# Incognito-Campus

A searchable Q&A knowledge base for recurring university doubts, built for a Database Management Systems course.
Students ask and answer **anonymously**, teachers answer under their **verified real names**, and every
resolved thread becomes part of a permanent knowledge base. Before posting, a student searches by *meaning*
(semantic search with PostgreSQL + pgvector), so repeat doubts are answered instantly instead of re-asked.

**Team:** Diya B R (PES1UG24AM097) and Janavi Agrawal (PES1UG24AM120)

## Status

| Area | State |
|---|---|
| Schema (14 tables), seed data, constraints, indexes | Done |
| Login (JWT), roles, posts, answers, comments, votes, accept answer, tags, subjects (API + web UI) | Done |
| pgvector setup, embeddings, semantic search, duplicate detection | Done (`embed_posts.py`, Python search service) |
| Merge duplicates, report moderation (triggers + functions) | Done |
| Dashboards, analytics queries, indexes with `EXPLAIN ANALYZE` | Done |
| Edge-case and integrity tests | Done |
| Search, duplicate suggestions, reporting, review queue, merge and moderation dashboard in the web UI / API | Done |

## Features

- **Anonymity by design:** students appear only by a generated handle (e.g. `CuriousOwl`); teachers appear by display name.
  Public queries never expose `user_id`.
- **Roles:** student, teacher (verified or not), admin. Only admins and *verified* teachers can moderate.
- **Q&A:** subjects, topics, tags, answers, comments on answers, up/down votes on posts and answers.
- **Accepted answers:** the asker or a verified teacher can accept an answer. A post may have more than one accepted answer.
- **Semantic search and duplicate detection:** each new post is embedded automatically (`all-MiniLM-L6-v2`, 384 dimensions) and compared by cosine similarity.
  The feed has a search box, and while a student writes a doubt, similar existing doubts are suggested. If the search service is down, search falls back to keyword matching and posting still works.
- **Merge workflow:** moderators can mark a doubt as a duplicate from its page. `merge_post()` closes it and points it at the original; its answers still appear under the original thread.
- **Moderation:** anyone can report a doubt or answer; admins and verified teachers get a review queue and dashboard. Rules are enforced in the database (no self-reports, reviewer must be a moderator, decided reports can't be reopened).
- **Dashboards:** review queue, most-reported content, trending topics, aging unanswered doubts and more.

## Tech stack

PostgreSQL 16 + pgvector · Node.js (Express 5, `pg`, JWT, bcryptjs) · vanilla HTML/JS front end · Python (Flask, sentence-transformers, psycopg2) · Docker

## Repository layout

```
schema.sql                      14 tables, constraints, indexes (drops and recreates everything)
seed.sql                        sample users, subjects, posts, answers, votes, reports
queries.sql                     feed / per-teacher / per-subject queries and integrity checks
embed_posts.py                  embeddings, semantic search, duplicate check (also runs from the command line)
search_service.py               small Flask API around embed_posts.py, called by the Node server
requirements.txt                Python packages
migrations/
  001_search_moderation.sql     embeddings primary key, merged_into column, report rules
  002_merge_and_moderation.sql  merge_post(), review_report(), report triggers, thread view
  003_dashboards_indexes.sql    two measured indexes for the dashboards
queries/
  dashboards.sql                eight analytics and moderation queries
  explain_demo.sql              EXPLAIN ANALYZE before/after demo
tests/
  test_merge_moderation.sql     merge and moderation behaviour (changes data, reload afterwards)
  test_edge_cases.sql           embeddings, votes, cascades, integrity (rolls back, safe to rerun)
  smoke_integration.js          end-to-end API test: search, duplicates, reports, review, merge
  bulk_data.sql                 ~100k-post fake dataset for the EXPLAIN demo
src/                            Node API (routes/search.js, routes/moderation.js and services/searchClient.js are the search and moderation parts)
public/                         web UI (extras.js and extras.css add search, duplicate suggestions, reporting and moderation)
```

## Setup

You need Docker Desktop, Node.js 18+ and Python 3.10+.

### 1. Start PostgreSQL with pgvector

The container uses host port **5433**, so it can't clash with a PostgreSQL installed directly on your machine.

```powershell
docker run --name incognito-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=incognito_campus -p 5433:5432 -v incognito_data:/var/lib/postgresql/data -d pgvector/pgvector:pg16
```

Next time, if the container has stopped: `docker start incognito-db`.

### 2. Load the database (in this order)

```powershell
foreach ($f in "schema.sql","seed.sql","migrations/001_search_moderation.sql","migrations/002_merge_and_moderation.sql","migrations/003_dashboards_indexes.sql") {
  docker cp $f incognito-db:/tmp/load.sql
  docker exec incognito-db psql -U postgres -d incognito_campus -v ON_ERROR_STOP=1 -q -f /tmp/load.sql
}
```

`NOTICE: ... does not exist, skipping` lines are normal. Anything starting with `ERROR:` is not.
Re-running `schema.sql` wipes all data, so reload every file after it.

### 3. Create embeddings

```powershell
pip install -r requirements.txt
$env:DB_PORT = "5433"
python embed_posts.py --rebuild
```

The first run downloads the model (about 90 MB). Run without `--rebuild` later to embed only posts that are missing one.
Connection settings can be overridden with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

### 4. Start the search service

In a second terminal, from the repository root:

```powershell
$env:DB_PORT = "5433"
python search_service.py
```

It listens on http://127.0.0.1:8001 and is only used by the Node server. The app works without it (keyword search, no duplicate suggestions);
posts created while it is down are indexed later. To index them, call `POST http://localhost:8001/embed-missing` or run `python embed_posts.py`.
For a quick wiring test without downloading the model, set `$env:EMBEDDER = "fake"` first. Never use that for the real demo.

### 5. Run the web app

```powershell
npm install
copy .env.example .env
```

Edit `.env`: set `JWT_SECRET` to any long random string and make `DATABASE_URL` point at the Docker database:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/incognito_campus
```

```powershell
npm start
```

Open http://localhost:3000.

### 6. Demo logins

Seed users have placeholder password hashes, so nobody can log in until you set a password.
For local demos only, give every user the same password:

```powershell
docker exec incognito-db psql -U postgres -d incognito_campus -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; UPDATE users SET password_hash = crypt('demo1234', gen_salt('bf', 10));"
```

Then sign in with a user ID and `demo1234`:

| User ID | Role |
|---|---|
| `PES1UG24AM001`, `PES1UG24AM002`, `PES1UG24AM003`, `PES1UG24CS001`, `PES1UG24CS002`, `PES1UG24CS003` | student |
| `FAC001`, `FAC002`, `FAC003` | verified teacher |
| `FAC004` | teacher, **not verified** (used to test permission checks) |
| `ADMIN001` | admin |

## Try it

In the app: sign in as `PES1UG24AM001`, type a doubt like "Is 3NF always BCNF?" in *Ask a doubt* and watch similar doubts appear before you publish.
Sign in as `FAC001` (or `ADMIN001`) to see the **Moderation** button, the review queue, and *Mark as duplicate…* on any doubt.

Automated end-to-end check (needs a freshly loaded database, the demo passwords, the app and the search service running):

```powershell
node tests/smoke_integration.js
```

## Try the database features

```powershell
# semantic search + duplicate check (printed by the script)
python embed_posts.py

# analytics and moderation dashboards
docker cp queries/dashboards.sql incognito-db:/tmp/d.sql
docker exec incognito-db psql -U postgres -d incognito_campus -f /tmp/d.sql

# edge-case tests (rolls back, safe anytime): look for zero FAIL rows
docker cp tests/test_edge_cases.sql incognito-db:/tmp/edge.sql
docker exec incognito-db psql -U postgres -d incognito_campus -f /tmp/edge.sql
```

Merge and review from `psql`:

```sql
-- merge post 2 into post 1 (only an admin or verified teacher is allowed)
SELECT merge_post('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'ADMIN001');

-- decide a pending report: 'actioned' or 'dismissed'
SELECT review_report(report_id, 'ADMIN001', 'dismissed') FROM report WHERE status = 'pending' LIMIT 1;
```

These change data. Reload step 2 and rerun `embed_posts.py --rebuild` to reset.

For the `EXPLAIN ANALYZE` demo, use a **separate** database: load the five files from step 2, load `tests/bulk_data.sql`,
run `queries/explain_demo.sql` (before), apply `migrations/003_dashboards_indexes.sql`, run `VACUUM ANALYZE;`
and run `explain_demo.sql` again (after).

## Design decisions

- **Embeddings are a weak entity of `post`:** `post_embeddings.post_id` is both primary key and foreign key with `ON DELETE CASCADE`.
  Each row stores the model name, so vectors can be regenerated if the model changes.
- **Identity:** `users` holds login data; `student` adds the anonymous handle; `teacher` adds the display name and verification flag.
- **Merged duplicates keep their answers.** Moving them could create two accepted answers on one post and would break the comment-to-post link.
  The `v_thread_answers` view shows them under the original instead.
- **Several accepted answers are allowed** (for example the asker's pick and a teacher's pick).
- **Moderation rules live in the database** (trigger `report_rules`, functions `merge_post` and `review_report`),
  so they hold no matter which client talks to the database. `merge_post` and `review_report` lock rows to prevent two moderators acting on the same item.
- **Indexes were chosen by measurement.** On ~100k posts: the pending-reports partial index took the review queue from 1.1 ms to 0.15 ms,
  and the covering index took trending topics from about 21 ms to about 6.5 ms. Rewriting the most-reported query to aggregate before joining
  cut it from about 45 ms to about 6 ms with no index at all. Two other candidate indexes gave little gain and were left out.

## Known gaps

- Answers written on a merged duplicate are shown under the original but are read-only there (vote, accept and comment on that duplicate's own page).
- The search service has no login of its own. It only listens on `127.0.0.1`, so only the Node server on the same machine can reach it.
- `comment.post_id` duplicates what `answer_id` already implies and nothing forces them to agree (shown as `GAP` in `tests/test_edge_cases.sql`).
  The fix is a composite foreign key from `comment (answer_id, post_id)` to `answer (answer_id, post_id)`.
- Deleting an original post leaves its merged duplicates closed with no parent.
- Users who have written content cannot be deleted (by design: deactivate instead).
- Migrations 001 to 003 are not yet merged into `schema.sql`.
- Seed password hashes are placeholders (see "Demo logins").

## Ownership

| Area | Owner |
|---|---|
| Core platform: schema, authentication, role-based access, posts, answers, comments, votes, web UI | Diya |
| Intelligence and moderation: pgvector, embeddings, semantic search, duplicates and merge, reporting and moderation, dashboards, indexes, tests | Janavi |
