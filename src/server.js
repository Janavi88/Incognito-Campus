require('dotenv').config();

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('Set DATABASE_URL and JWT_SECRET in your .env file.');
}

const express = require('express');
const path = require('path');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const answerRoutes = require('./routes/answers');
const commentRoutes = require('./routes/comments');
const subjectRoutes = require('./routes/subjects');
const { requireAuth, requireRole, requireVerifiedTeacher } = require('./middleware/requireAuth');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/posts/:postId/answers', answerRoutes);
app.use('/api/posts/:postId/answers/:answerId/comments', commentRoutes);

app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.email, u.role,
              s.anonymous_handle, t.display_name, t.is_verified
         FROM users u
         LEFT JOIN student s ON s.user_id = u.user_id
         LEFT JOIN teacher t ON t.user_id = u.user_id
        WHERE u.user_id = $1`,
      [req.auth.sub],
    );

    if (!rows[0]) return res.status(401).json({ error: 'This account no longer exists.' });
    const user = rows[0];
    const profile = user.role === 'student'
      ? { anonymousHandle: user.anonymous_handle }
      : user.role === 'teacher'
        ? { displayName: user.display_name, isVerified: user.is_verified }
        : {};
    return res.json({ user: { userId: user.user_id, email: user.email, role: user.role, profile } });
  } catch (error) {
    return next(error);
  }
});

// Example role-protected routes for the next application features.
app.get('/api/teacher-area', requireAuth, requireVerifiedTeacher, (_req, res) => {
  res.json({ message: 'Verified teacher access granted.' });
});
app.get('/api/admin-area', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ message: 'Admin access granted.' });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`Incognito Campus API listening on port ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
