const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  const { identifier, password } = req.body ?? {};
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    return res.status(400).json({ error: 'Enter your email or user ID and password.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.email, u.password_hash, u.role,
              s.anonymous_handle, t.display_name, t.is_verified
         FROM users u
         LEFT JOIN student s ON s.user_id = u.user_id
         LEFT JOIN teacher t ON t.user_id = u.user_id
        WHERE lower(u.email) = lower($1) OR lower(u.user_id) = lower($1)
        LIMIT 1`,
      [identifier.trim()],
    );

    const user = rows[0];
    const passwordMatches = user && await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email/user ID or password.' });
    }

    const claims = {
      sub: user.user_id,
      role: user.role,
      teacherVerified: user.role === 'teacher' && user.is_verified === true,
    };
    if (user.role === 'student') claims.anonymousHandle = user.anonymous_handle;
    if (user.role === 'teacher') claims.displayName = user.display_name;
    const token = jwt.sign(claims, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    });

    const profile = user.role === 'student'
      ? { anonymousHandle: user.anonymous_handle }
      : user.role === 'teacher'
        ? { displayName: user.display_name, isVerified: user.is_verified }
        : {};

    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
      user: { userId: user.user_id, email: user.email, role: user.role, profile },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
