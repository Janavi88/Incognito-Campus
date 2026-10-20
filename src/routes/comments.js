const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router({ mergeParams: true });

router.post('/', requireAuth, async (req, res, next) => {
  const { body } = req.body ?? {};
  if (typeof body !== 'string' || !body.trim() || body.trim().length > 5000) {
    return res.status(400).json({ error: 'A comment of 1 to 5,000 characters is required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO comment (post_id, answer_id, user_id, body)
       SELECT $1, a.answer_id, $3, $4
         FROM answer a
        WHERE a.answer_id = $2 AND a.post_id = $1
       RETURNING comment_id, post_id, answer_id, body, created_at`,
      [req.params.postId, req.params.answerId, req.auth.sub, body.trim()],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Answer not found for this doubt.' });
    const authorName = req.auth.role === 'student'
      ? req.auth.anonymousHandle
      : req.auth.role === 'teacher' ? req.auth.displayName : 'Moderator';
    return res.status(201).json({ comment: { ...rows[0], authorName, authorRole: req.auth.role } });
  } catch (error) {
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt or answer ID.' });
    return next(error);
  }
});

module.exports = router;
