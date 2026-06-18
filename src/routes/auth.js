/**
 * Authentication routes.
 * Supports password auth, TOTP 2FA, refresh tokens, and logout.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const { User } = require('../models');
const { getSettings } = require('../services/settings');
const { logAuditEvent } = require('../services/audit');
const {
  storeRefreshToken,
  getRefreshToken,
  invalidateRefreshToken,
  blacklistToken
} = require('../services/redis');

const router = express.Router();
const PRE_AUTH_TOKEN_SECRET = process.env.PRE_AUTH_TOKEN_SECRET || process.env.JWT_SECRET;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.ip}:${email || 'unknown'}`;
  },
  message: { error: 'Too many login attempts. Please try again later.' }
});

function createAuthTokens(user) {
  const accessToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, preAuthToken, twoFactorCode } = req.body;
    let user = null;

    if (preAuthToken) {
      const decoded = jwt.verify(preAuthToken, PRE_AUTH_TOKEN_SECRET);
      if (decoded.purpose !== 'login-2fa') {
        return res.status(401).json({ error: 'Invalid 2FA challenge' });
      }
      user = await User.findByPk(decoded.userId);
    } else {
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }

      user = await User.findOne({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const settings = await getSettings();
    if (user.role === 'employee' && !settings.allowEmployeePortal) {
      return res.status(403).json({ error: 'Employee self-service portal is disabled' });
    }

    const enforcedTwoFactor = (
      (user.role === 'admin' && settings.requireTwoFactorForAdmins) ||
      (user.role === 'employee' && settings.requireTwoFactorForEmployees)
    );

    if (enforcedTwoFactor && !user.twoFactorEnabled) {
      return res.status(403).json({
        error: 'Two-factor authentication must be configured before login',
        requiresTwoFactorSetup: true
      });
    }

    if (user.twoFactorEnabled) {
      const normalizedCode = String(twoFactorCode || '').replace(/\s+/g, '');
      if (!normalizedCode) {
        const challengeToken = jwt.sign(
          { userId: user.id, purpose: 'login-2fa' },
          PRE_AUTH_TOKEN_SECRET,
          { expiresIn: '5m' }
        );

        return res.json({
          requiresTwoFactor: true,
          preAuthToken: challengeToken
        });
      }

      const isValidCode = authenticator.check(normalizedCode, user.twoFactorSecret);
      if (!isValidCode) {
        return res.status(401).json({ error: 'Invalid two-factor code' });
      }
    }

    const { accessToken, refreshToken } = createAuthTokens(user);
    const refreshTtl = 7 * 24 * 60 * 60;
    await storeRefreshToken(user.id, refreshToken, refreshTtl);

    await logAuditEvent({
      userId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'login',
      resourceType: 'auth',
      method: 'POST',
      path: '/api/auth/login',
      ipAddress: req.ip,
      statusCode: 200,
      metadata: {
        usedTwoFactor: Boolean(user.twoFactorEnabled)
      }
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Two-factor challenge expired' });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const storedToken = await getRefreshToken(decoded.userId);
    if (storedToken !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or disabled' });
    }

    const { accessToken } = createAuthTokens(user);
    res.json({ accessToken });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    console.error('Refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    const { refreshToken } = req.body || {};
    let userId = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        userId = decoded.userId;

        const expiresAt = decoded.exp || 0;
        const now = Math.floor(Date.now() / 1000);
        const ttlSeconds = Math.max(expiresAt - now, 1);
        await blacklistToken(token, ttlSeconds);
      } catch (error) {
        // best effort, refresh token revocation still runs below
      }
    }

    if (!userId && refreshToken) {
      try {
        const decodedRefresh = jwt.verify(
          refreshToken,
          process.env.REFRESH_TOKEN_SECRET,
          { ignoreExpiration: true }
        );
        userId = decodedRefresh.userId;
      } catch (error) {
        // ignore malformed refresh tokens
      }
    }

    if (userId) {
      await invalidateRefreshToken(userId);
      await logAuditEvent({
        userId,
        action: 'logout',
        resourceType: 'auth',
        method: 'POST',
        path: '/api/auth/logout',
        ipAddress: req.ip,
        statusCode: 200,
        metadata: {}
      });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * Embed auth — allows the CRM iframe to auto-authenticate
 * using a pre-shared EMBED_SECRET (set in .env).
 * Returns admin JWT tokens without requiring email/password.
 */
router.post('/embed-login', async (req, res) => {
  try {
    const { embedSecret } = req.body;
    const configuredSecret = process.env.EMBED_SECRET || process.env.EMBED_LOGIN_SECRET;
    const legacySecrets = [
      'thainaturals-monitor-embed-2026',
      ...String(process.env.LEGACY_EMBED_SECRETS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ];
    const allowedSecrets = new Set([configuredSecret, ...legacySecrets].filter(Boolean));

    if (!embedSecret || !allowedSecrets.has(embedSecret)) {
      return res.status(401).json({ error: 'Invalid embed secret' });
    }

    // Find the first active admin user
    const admin = await User.findOne({ where: { role: 'admin', isActive: true } });
    if (!admin) {
      return res.status(500).json({ error: 'No admin user available' });
    }

    const { accessToken, refreshToken } = createAuthTokens(admin);
    const refreshTtl = 7 * 24 * 60 * 60;
    await storeRefreshToken(admin.id, refreshToken, refreshTtl);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      }
    });
  } catch (error) {
    console.error('Embed login error:', error);
    res.status(500).json({ error: 'Embed login failed' });
  }
});

module.exports = router;
