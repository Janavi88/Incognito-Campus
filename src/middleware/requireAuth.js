const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.get('authorization');
  const [scheme, token] = header ? header.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in to access this resource.' });
  }

  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired.' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.get('authorization');
  if (!header) return next();
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Your session is invalid or expired.' });
  }
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Sign in to access this resource.' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    return next();
  };
}

function requireVerifiedTeacher(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'Sign in to access this resource.' });
  }
  if (req.auth.role !== 'teacher' || req.auth.teacherVerified !== true) {
    return res.status(403).json({ error: 'This feature is for verified teachers.' });
  }
  return next();
}

function requireAnswerer(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'Sign in to access this resource.' });
  }
  if (req.auth.role === 'student') return next();
  if (req.auth.role === 'teacher' && req.auth.teacherVerified === true) return next();
  return res.status(403).json({ error: 'Only students and verified teachers can answer doubts.' });
}

module.exports = { requireAuth, optionalAuth, requireRole, requireVerifiedTeacher, requireAnswerer };
