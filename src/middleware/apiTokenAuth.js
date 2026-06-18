const crypto = require('crypto');
const { ApiToken } = require('../models');

async function apiTokenAuth(req, res, next) {
  try {
    const rawToken = req.headers['x-api-token'];
    if (!rawToken) {
      return res.status(401).json({ error: 'API token required' });
    }

    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    const token = await ApiToken.findOne({
      where: {
        tokenHash,
        isActive: true
      }
    });

    if (!token) {
      return res.status(401).json({ error: 'Invalid API token' });
    }

    token.lastUsedAt = new Date();
    await token.save();

    req.apiToken = token;
    next();
  } catch (error) {
    console.error('API token auth error:', error);
    res.status(500).json({ error: 'API token authentication failed' });
  }
}

module.exports = { apiTokenAuth };
