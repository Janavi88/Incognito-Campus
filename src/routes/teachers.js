const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/teachers?q=anita
// Search teachers by name for doubt mentions
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let queryText;
    let queryParams;

    if (q) {
      queryText = `
        SELECT t.user_id, t.display_name, t.is_verified, u.department
          FROM teacher t
          JOIN users u ON u.user_id = t.user_id
         WHERE t.display_name ILIKE $1
         ORDER BY t.display_name
         LIMIT 20
      `;
      queryParams = [`%${q}%`];
    } else {
      queryText = `
        SELECT t.user_id, t.display_name, t.is_verified, u.department
          FROM teacher t
          JOIN users u ON u.user_id = t.user_id
         ORDER BY t.display_name
         LIMIT 20
      `;
      queryParams = [];
    }

    const { rows } = await pool.query(queryText, queryParams);
    return res.json({ teachers: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
