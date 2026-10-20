const express = require('express');
const pool = require('../db');
const { requireAuth, requireAnswerer } = require('../middleware/requireAuth');

const router = express.Router({ mergeParams: true });

router.post('/:answerId/accept', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: posts } = await client.query(
      'SELECT user_id, status FROM post WHERE post_id = $1 FOR UPDATE',
      [req.params.postId],
    );
    if (!posts[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Doubt not found.' });
    }
    if (posts[0].status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A closed doubt cannot accept an answer.' });
    }

    const isVerifiedTeacher = req.auth.role === 'teacher' && req.auth.teacherVerified === true;
    if (posts[0].user_id !== req.auth.sub && !isVerifiedTeacher) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the student who asked or a verified teacher can accept an answer.' });
    }

    const { rows: answers } = await client.query(
      `UPDATE answer
          SET is_accepted = TRUE
        WHERE answer_id = $1 AND post_id = $2
        RETURNING answer_id, post_id, is_accepted`,
      [req.params.answerId, req.params.postId],
    );
    if (!answers[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Answer not found for this doubt.' });
    }

    await client.query(
      "UPDATE post SET status = 'resolved' WHERE post_id = $1",
      [req.params.postId],
    );
    await client.query('COMMIT');
    return res.json({ answer: answers[0], postStatus: 'resolved' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt or answer ID.' });
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:answerId/unaccept', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: posts } = await client.query(
      'SELECT user_id, status FROM post WHERE post_id = $1 FOR UPDATE',
      [req.params.postId],
    );
    if (!posts[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Doubt not found.' });
    }

    const isVerifiedTeacher = req.auth.role === 'teacher' && req.auth.teacherVerified === true;
    if (posts[0].user_id !== req.auth.sub && !isVerifiedTeacher) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the student who asked or a verified teacher can change acceptance.' });
    }

    const { rows: answers } = await client.query(
      `UPDATE answer
          SET is_accepted = FALSE
        WHERE answer_id = $1 AND post_id = $2
        RETURNING answer_id, post_id, is_accepted`,
      [req.params.answerId, req.params.postId],
    );
    if (!answers[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Answer not found for this doubt.' });
    }

    let postStatus = posts[0].status;
    if (postStatus !== 'closed') {
      const { rows: remaining } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM answer WHERE post_id = $1 AND is_accepted) AS has_accepted_answer',
        [req.params.postId],
      );
      postStatus = remaining[0].has_accepted_answer ? 'resolved' : 'open';
      await client.query('UPDATE post SET status = $2 WHERE post_id = $1', [req.params.postId, postStatus]);
    }

    await client.query('COMMIT');
    return res.json({ answer: answers[0], postStatus });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt or answer ID.' });
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/', requireAuth, requireAnswerer, async (req, res, next) => {
  const { body } = req.body ?? {};
  if (typeof body !== 'string' || !body.trim() || body.trim().length > 20000) {
    return res.status(400).json({ error: 'An answer of 1 to 20,000 characters is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: postRows } = await client.query(
      'SELECT status FROM post WHERE post_id = $1 FOR UPDATE',
      [req.params.postId],
    );
    if (!postRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Doubt not found.' });
    }
    if (postRows[0].status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This doubt is closed and no longer accepts answers.' });
    }

    const { rows } = await client.query(
      `INSERT INTO answer (post_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING answer_id, post_id, body, is_accepted, created_at`,
      [req.params.postId, req.auth.sub, body.trim()],
    );
    await client.query('COMMIT');
    return res.status(201).json({
      answer: {
        ...rows[0],
        author: req.auth.role === 'student'
          ? { role: 'student', name: req.auth.anonymousHandle, anonymous: true }
          : { role: 'teacher', name: req.auth.displayName, anonymous: false },
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Invalid doubt ID.' });
    }
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:answerId/votes', requireAuth, async (req, res, next) => {
  const voteValue = Number(req.body?.voteValue);
  if (![1, -1].includes(voteValue)) {
    return res.status(400).json({ error: 'voteValue must be 1 (upvote) or -1 (downvote).' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO votes (user_id, answer_id, vote_value)
       SELECT $1, a.answer_id, $4
         FROM answer a
        WHERE a.answer_id = $2 AND a.post_id = $3
       ON CONFLICT (user_id, answer_id)
       DO UPDATE SET vote_value = EXCLUDED.vote_value, created_at = now()
       RETURNING vote_value`,
      [req.auth.sub, req.params.answerId, req.params.postId, voteValue],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Answer not found for this doubt.' });
    const { rows: totals } = await pool.query(
      'SELECT COALESCE(sum(vote_value)::int, 0) AS vote_score FROM votes WHERE answer_id = $1',
      [req.params.answerId],
    );
    return res.json({ vote: rows[0], voteScore: totals[0].vote_score });
  } catch (error) {
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid doubt or answer ID.' });
    return next(error);
  }
});

module.exports = router;
