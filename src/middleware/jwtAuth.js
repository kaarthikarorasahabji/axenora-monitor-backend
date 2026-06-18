/**
 * JWT authentication middleware
 * Validates Bearer token for dashboard routes
 */

const jwt = require('jsonwebtoken');
const { getRedisClient } = require('../services/redis');

async function jwtAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }
    
    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token is blacklisted in Redis
    const redis = getRedisClient();
    const result = await redis.get(`blacklist:${token}`);

    if (result) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Attach decoded user info to request
    req.user = decoded;
    next();
    
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('JWT auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

module.exports = { jwtAuth, requireRole };
