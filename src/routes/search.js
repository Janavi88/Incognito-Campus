const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { search, findDuplicates } = require('../services/searchClient');

const router = express.Router();

// Used only when the semantic search service is unreachable: plain word matching.
async function keywordSearch(q, subjectId, limit, excludePostId) {
  const words = [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 6);
  if (words.length === 0) return [];
  const patterns = words.map((w) => `%${w}%`);
  const { rows } = await pool.query(
    `SELECT p.post_id, p.title, p.status, NULL::float AS similarity, s.subject_code
       FROM post p
       JOIN subject s ON s.subject_id = p.subject_id
      WHERE p.merged_into IS NULL
        AND (p.title ILIKE ANY ($1) OR p.body ILIKE ANY ($1))
        AND ($2::text IS NULL OR p.subject_id = $2)
        AND ($3::uuid IS NULL OR p.post_id <> $3)
      ORDER BY p.created_at DESC
      LIMIT $4`,
    [patterns, subjectId, excludePostId, limit],
  );
  return rows;
}

// GET /api/search?q=bcnf vs 3nf&subjectId=SUB001&limit=10&excludePostId=<uuid>
router.get('/', async (req, res, next) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 3 || q.length > 300) {
    return res.status(400).json({ error: 'Type between 3 and 300 characters to search.' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 25);
  const subjectId = typeof req.query.subjectId === 'string' && req.query.subjectId ? req.query.subjectId : null;
  const excludePostId = typeof req.query.excludePostId === 'string' && req.query.excludePostId
    ? req.query.excludePostId : null;

  try {
    const data = await search({ query: q, limit, subjectId, excludePostId });
    return res.json({ mode: 'semantic', results: data.results });
  } catch (error) {
    console.warn(`Semantic search unavailable, using keyword search: ${error.message}`);
  }
  try {
    const results = await keywordSearch(q, subjectId, limit, excludePostId);
    return res.json({ mode: 'keyword', results });
  } catch (error) {
    if (error.code === '22P02') return res.status(400).json({ error: 'Invalid ID.' });
    return next(error);
  }
});

// POST /api/search/duplicates  { title, body, subjectId? }  -> likely duplicates of a doubt being written
router.post('/duplicates', requireAuth, requireRole('student'), async (req, res) => {
  const { title, body = '', subjectId = null } = req.body ?? {};
  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 255) {
    return res.status(400).json({ error: 'A title of 3 to 255 characters is required.' });
  }
  if (typeof body !== 'string' || body.length > 20000) {
    return res.status(400).json({ error: 'The description is too long.' });
  }
  try {
    const data = await findDuplicates({ title: title.trim(), body: body.trim(), subjectId });
    return res.json({ available: true, threshold: data.threshold, duplicates: data.duplicates });
  } catch (error) {
    // Never block someone from posting just because duplicate detection is down.
    console.warn(`Duplicate check unavailable: ${error.message}`);
    return res.json({ available: false, duplicates: [] });
  }
});

module.exports = router;
