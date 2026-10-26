const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { findOrCreateSubject } = require('../services/subjectService');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.subject_id, s.subject_code, s.subject_name,
              COALESCE(json_agg(json_build_object('name', t.topic_name) ORDER BY t.topic_name)
                FILTER (WHERE t.topic_name IS NOT NULL), '[]'::json) AS topics
         FROM subject s
         LEFT JOIN topic t ON t.subject_id = s.subject_id
        GROUP BY s.subject_id, s.subject_code, s.subject_name
        ORDER BY s.subject_name`,
    );
    return res.json({ subjects: rows });
  } catch (error) {
    return next(error);
  }
});

// POST /api/subjects { subjectName }
router.post('/', requireAuth, async (req, res, next) => {
  const rawName = req.body?.subjectName ?? req.body?.name;
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return res.status(400).json({ error: 'A subject name is required.' });
  }
  const cleanName = rawName.trim();
  if (cleanName.length > 150) {
    return res.status(400).json({ error: 'Subject name must be 150 characters or fewer.' });
  }

  try {
    const result = await findOrCreateSubject(pool, cleanName);
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
