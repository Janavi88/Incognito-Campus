const express = require('express');
const pool = require('../db');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.post_id, p.subject_id, p.topic_name, p.title, p.body, p.status, p.created_at,
              s.subject_code, s.subject_name,
              u.role AS author_role,
              COALESCE(st.anonymous_handle, t.display_name) AS author_name,
              (SELECT count(*)::int FROM answer a WHERE a.post_id = p.post_id) AS answer_count,
              COALESCE((
                SELECT json_agg(json_build_object('id', tag.tag_id, 'name', tag.tag_name) ORDER BY tag.tag_name)
                  FROM post_tag pt JOIN tag ON tag.tag_id = pt.tag_id
                 WHERE pt.post_id = p.post_id
              ), '[]'::json) AS tags
         FROM post p
         JOIN subject s ON s.subject_id = p.subject_id
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN student st ON st.user_id = u.user_id
         LEFT JOIN teacher t ON t.user_id = u.user_id
        ORDER BY p.created_at DESC
        LIMIT 100`,
    );
    return res.json({ posts: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:postId', optionalAuth, async (req, res, next) => {
  try {
    const { rows: postRows } = await pool.query(
      `SELECT p.post_id, p.subject_id, p.topic_name, p.title, p.body, p.status, p.created_at,
              s.subject_code, s.subject_name, u.role AS author_role,
              (p.user_id = $2) AS can_accept_as_owner,
              COALESCE(st.anonymous_handle, t.display_name) AS author_name,
              COALESCE((
                SELECT json_agg(json_build_object('id', tag.tag_id, 'name', tag.tag_name) ORDER BY tag.tag_name)
                  FROM post_tag pt JOIN tag ON tag.tag_id = pt.tag_id
                 WHERE pt.post_id = p.post_id
              ), '[]'::json) AS tags,
              COALESCE((SELECT sum(v.vote_value)::int FROM votes v WHERE v.post_id = p.post_id), 0) AS vote_score,
              (SELECT v.vote_value FROM votes v WHERE v.post_id = p.post_id AND v.user_id = $2) AS my_vote
         FROM post p
         JOIN subject s ON s.subject_id = p.subject_id
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN student st ON st.user_id = u.user_id
         LEFT JOIN teacher t ON t.user_id = u.user_id
        WHERE p.post_id = $1`,
      [req.params.postId, req.auth?.sub || null],
    );
    if (!postRows[0]) return res.status(404).json({ error: 'Doubt not found.' });

    const { rows: answers } = await pool.query(
      `SELECT a.answer_id, a.body, a.is_accepted, a.created_at, u.role AS author_role,
              COALESCE(st.anonymous_handle, t.display_name) AS author_name,
              COALESCE((SELECT sum(v.vote_value)::int FROM votes v WHERE v.answer_id = a.answer_id), 0) AS vote_score,
              (SELECT v.vote_value FROM votes v WHERE v.answer_id = a.answer_id AND v.user_id = $2) AS my_vote,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'commentId', c.comment_id, 'body', c.body, 'createdAt', c.created_at,
                  'authorRole', cu.role,
                  'authorName', COALESCE(cs.anonymous_handle, ct.display_name)
                ) ORDER BY c.created_at)
                  FROM comment c
                  JOIN users cu ON cu.user_id = c.user_id
                  LEFT JOIN student cs ON cs.user_id = cu.user_id
                  LEFT JOIN teacher ct ON ct.user_id = cu.user_id
                 WHERE c.answer_id = a.answer_id
              ), '[]'::json) AS comments
         FROM answer a
         JOIN users u ON u.user_id = a.user_id
         LEFT JOIN student st ON st.user_id = u.user_id
         LEFT JOIN teacher t ON t.user_id = u.user_id
        WHERE a.post_id = $1
        ORDER BY a.is_accepted DESC, a.created_at`,
      [req.params.postId, req.auth?.sub || null],
    );
    return res.json({ post: { ...postRows[0], answers } });
  } catch (error) {
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt ID.' });
    return next(error);
  }
});

router.post('/:postId/votes', requireAuth, async (req, res, next) => {
  const voteValue = Number(req.body?.voteValue);
  if (![1, -1].includes(voteValue)) {
    return res.status(400).json({ error: 'voteValue must be 1 (upvote) or -1 (downvote).' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO votes (user_id, post_id, vote_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, post_id)
       DO UPDATE SET vote_value = EXCLUDED.vote_value, created_at = now()
       RETURNING vote_value`,
      [req.auth.sub, req.params.postId, voteValue],
    );
    const { rows: totals } = await pool.query(
      'SELECT COALESCE(sum(vote_value)::int, 0) AS vote_score FROM votes WHERE post_id = $1',
      [req.params.postId],
    );
    return res.json({ vote: rows[0], voteScore: totals[0].vote_score });
  } catch (error) {
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt ID.' });
    if (error.code === '23503') return res.status(404).json({ error: 'Doubt not found.' });
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('student'), async (req, res, next) => {
  const { subjectId, topicName = null, title, body, tags = [] } = req.body ?? {};

  if (typeof subjectId !== 'string' || !subjectId.trim() || subjectId.trim().length > 20) {
    return res.status(400).json({ error: 'Choose a valid subject.' });
  }
  if (topicName !== null && (typeof topicName !== 'string' || !topicName.trim() || topicName.trim().length > 100)) {
    return res.status(400).json({ error: 'Choose a valid topic or leave it empty.' });
  }
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 255) {
    return res.status(400).json({ error: 'A title of 1 to 255 characters is required.' });
  }
  if (typeof body !== 'string' || !body.trim() || body.trim().length > 20000) {
    return res.status(400).json({ error: 'A doubt description of 1 to 20,000 characters is required.' });
  }
  if (!Array.isArray(tags) || tags.length > 10 || tags.some((tag) => typeof tag !== 'string')) {
    return res.status(400).json({ error: 'Provide up to 10 text tags.' });
  }

  const cleanTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/^#+/, '')).filter(Boolean))];
  if (cleanTags.some((tag) => tag.length > 50)) {
    return res.status(400).json({ error: 'Each tag must be 50 characters or fewer.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: postRows } = await client.query(
      `INSERT INTO post (user_id, subject_id, topic_name, title, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING post_id, subject_id, topic_name, title, body, status, created_at`,
      [req.auth.sub, subjectId.trim(), topicName?.trim() || null, title.trim(), body.trim()],
    );
    const post = postRows[0];
    const savedTags = [];

    for (const tagName of cleanTags) {
      const { rows } = await client.query(
        `INSERT INTO tag (tag_name) VALUES ($1)
         ON CONFLICT (tag_name) DO UPDATE SET tag_name = EXCLUDED.tag_name
         RETURNING tag_id, tag_name`,
        [tagName],
      );
      const tag = rows[0];
      await client.query(
        'INSERT INTO post_tag (post_id, tag_id) VALUES ($1, $2)',
        [post.post_id, tag.tag_id],
      );
      savedTags.push({ id: tag.tag_id, name: tag.tag_name });
    }

    await client.query('COMMIT');
    return res.status(201).json({ post: { ...post, tags: savedTags } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return res.status(400).json({ error: 'The selected subject or topic does not exist.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
