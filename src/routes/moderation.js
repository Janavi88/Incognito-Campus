const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Same rule as the database function is_moderator(): admin, or a VERIFIED teacher.
// (The database re-checks this on every merge/review, so a stale token can't bypass it.)
function requireModerator(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Sign in to access this resource.' });
  const ok = req.auth.role === 'admin' || (req.auth.role === 'teacher' && req.auth.teacherVerified === true);
  if (!ok) return res.status(403).json({ error: 'Only admins and verified teachers can moderate.' });
  return next();
}

// Translate database errors (our triggers/functions raise readable messages) into HTTP responses.
function dbError(error, res, next) {
  // Errors from the table's own CHECK/UNIQUE constraints carry error.constraint and are technical.
  const readable = error.constraint ? null : error.message;
  switch (error.code) {
    case '23505': return res.status(409).json({ error: 'You have already reported this.' });
    case '23514': return res.status(400).json({ error: readable || 'That request is not valid.' });
    case '42501': return res.status(403).json({ error: readable || 'You do not have permission to do this.' });
    case '23503': return res.status(404).json({ error: 'That doubt or answer does not exist.' });
    case '22P02': return res.status(400).json({ error: 'Invalid ID.' });
    case 'P0001':
      return res.status(/does not exist/.test(error.message) ? 404 : 409).json({ error: error.message });
    default: return next(error);
  }
}

// POST /api/reports  { postId | answerId, reason }   any signed-in user
router.post('/reports', requireAuth, async (req, res, next) => {
  const { postId = null, answerId = null, reason } = req.body ?? {};
  if ((postId === null) === (answerId === null)) {
    return res.status(400).json({ error: 'Report either a doubt (postId) or an answer (answerId).' });
  }
  if (typeof (postId ?? answerId) !== 'string') {
    return res.status(400).json({ error: 'Invalid ID.' });
  }
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) {
    return res.status(400).json({ error: 'Give a reason of 3 to 1000 characters.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO report (reporter_user_id, post_id, answer_id, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING report_id, status, created_at`,
      [req.auth.sub, postId, answerId, reason.trim()],
    );
    return res.status(201).json({ report: rows[0] });
  } catch (error) {
    return dbError(error, res, next);
  }
});

// GET /api/moderation/queue   pending reports, oldest first
router.get('/moderation/queue', requireAuth, requireModerator, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.report_id,
              CASE WHEN r.post_id IS NOT NULL THEN 'post' ELSE 'answer' END AS target_type,
              COALESCE(r.post_id, a.post_id) AS post_id,
              r.answer_id,
              COALESCE(p.title, left(a.body, 120)) AS preview,
              r.reason, r.created_at
         FROM report r
         LEFT JOIN post   p ON p.post_id   = r.post_id
         LEFT JOIN answer a ON a.answer_id = r.answer_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
        LIMIT 100`,
    );
    return res.json({ reports: rows });
  } catch (error) {
    return next(error);
  }
});

// POST /api/moderation/reports/:reportId/review  { decision: 'actioned' | 'dismissed' }
router.post('/moderation/reports/:reportId/review', requireAuth, requireModerator, async (req, res, next) => {
  const decision = req.body?.decision;
  if (!['actioned', 'dismissed'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'actioned' or 'dismissed'." });
  }
  try {
    await pool.query('SELECT review_report($1, $2, $3)', [req.params.reportId, req.auth.sub, decision]);
    return res.json({ reportId: req.params.reportId, status: decision });
  } catch (error) {
    return dbError(error, res, next);
  }
});

// POST /api/moderation/merge  { duplicatePostId, originalPostId }
router.post('/moderation/merge', requireAuth, requireModerator, async (req, res, next) => {
  const { duplicatePostId, originalPostId } = req.body ?? {};
  if (typeof duplicatePostId !== 'string' || typeof originalPostId !== 'string') {
    return res.status(400).json({ error: 'duplicatePostId and originalPostId are required.' });
  }
  try {
    await pool.query('SELECT merge_post($1, $2, $3)', [duplicatePostId, originalPostId, req.auth.sub]);
    return res.json({ merged: true, duplicatePostId, originalPostId });
  } catch (error) {
    return dbError(error, res, next);
  }
});

// GET /api/moderation/dashboard?days=90   the four dashboard queries from queries/dashboards.sql
router.get('/moderation/dashboard', requireAuth, requireModerator, async (req, res, next) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 365);
  try {
    const [mostReported, bySubject, trending, aging, backlog] = await Promise.all([
      pool.query(
        `WITH rp AS (
           SELECT post_id, count(*)::int AS total_reports,
                  (count(*) FILTER (WHERE status = 'pending'))::int AS pending
             FROM report WHERE post_id IS NOT NULL
            GROUP BY post_id ORDER BY total_reports DESC, pending DESC LIMIT 10
         ), ra AS (
           SELECT answer_id, count(*)::int AS total_reports,
                  (count(*) FILTER (WHERE status = 'pending'))::int AS pending
             FROM report WHERE answer_id IS NOT NULL
            GROUP BY answer_id ORDER BY total_reports DESC, pending DESC LIMIT 10
         )
         SELECT kind, target_id, post_id, preview, total_reports, pending FROM (
           SELECT 'post' AS kind, p.post_id AS target_id, p.post_id, p.title AS preview, rp.total_reports, rp.pending
             FROM rp JOIN post p ON p.post_id = rp.post_id
           UNION ALL
           SELECT 'answer', a.answer_id, a.post_id, left(a.body, 80), ra.total_reports, ra.pending
             FROM ra JOIN answer a ON a.answer_id = ra.answer_id
         ) u ORDER BY total_reports DESC, pending DESC LIMIT 10`),
      pool.query(
        `SELECT s.subject_code, count(*)::int AS reports,
                (count(*) FILTER (WHERE r.status = 'pending'))::int   AS pending,
                (count(*) FILTER (WHERE r.status = 'actioned'))::int  AS actioned,
                (count(*) FILTER (WHERE r.status = 'dismissed'))::int AS dismissed
           FROM report r
           LEFT JOIN answer a ON a.answer_id = r.answer_id
           JOIN post p        ON p.post_id   = COALESCE(r.post_id, a.post_id)
           JOIN subject s     ON s.subject_id = p.subject_id
          GROUP BY s.subject_code ORDER BY reports DESC`),
      pool.query(
        `WITH recent AS (
           SELECT post_id, subject_id, topic_name FROM post
            WHERE created_at >= now() - $1::int * interval '1 day'
              AND merged_into IS NULL AND topic_name IS NOT NULL
         ), ans AS (
           SELECT a.post_id, count(*) AS n FROM answer a JOIN recent r ON r.post_id = a.post_id GROUP BY a.post_id
         )
         SELECT s.subject_code, r.topic_name, count(*)::int AS new_doubts,
                COALESCE(sum(ans.n), 0)::int AS answers
           FROM recent r
           JOIN subject s ON s.subject_id = r.subject_id
           LEFT JOIN ans ON ans.post_id = r.post_id
          GROUP BY s.subject_code, r.topic_name
          ORDER BY new_doubts DESC, answers DESC LIMIT 10`, [days]),
      pool.query(
        `SELECT s.subject_code, s.subject_name, count(*)::int AS unanswered,
                min(p.created_at) AS oldest
           FROM post p JOIN subject s ON s.subject_id = p.subject_id
          WHERE p.status = 'open' AND p.merged_into IS NULL
            AND p.created_at < now() - interval '48 hours'
            AND NOT EXISTS (SELECT 1 FROM answer a WHERE a.post_id = p.post_id)
          GROUP BY s.subject_code, s.subject_name ORDER BY unanswered DESC`),
      pool.query(
        `SELECT count(*)::int AS missing
           FROM post p LEFT JOIN post_embeddings e ON e.post_id = p.post_id
          WHERE (e.post_id IS NULL OR e.embedding IS NULL) AND p.merged_into IS NULL`),
    ]);
    return res.json({
      days,
      mostReported: mostReported.rows,
      reportsBySubject: bySubject.rows,
      trendingTopics: trending.rows,
      agingUnanswered: aging.rows,
      postsMissingEmbedding: backlog.rows[0].missing,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
