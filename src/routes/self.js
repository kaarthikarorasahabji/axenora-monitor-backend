const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const { User, Activity, Screenshot } = require('../models');
const { getSignedUrl } = require('../services/storage');
const { getSettings } = require('../services/settings');
const { listCategoryRules } = require('../services/categoryRules');
const { buildTimesheetSummary } = require('../services/timesheets');
const { logAuditEvent } = require('../services/audit');
const { setCache, getCache, deleteCache } = require('../services/redis');
const { parseDateBoundary } = require('../utils/dateRange');

const router = express.Router();

async function ensureSelfPortalAccess(req, res, next) {
  try {
    const settings = await getSettings();
    if (req.user.role === 'employee' && !settings.allowEmployeePortal) {
      return res.status(403).json({ error: 'Employee self-service portal is disabled' });
    }
    req.selfSettings = settings;
    next();
  } catch (error) {
    next(error);
  }
}

router.use(ensureSelfPortalAccess);

router.get('/profile', async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, {
      attributes: [
        'id',
        'name',
        'email',
        'role',
        'machineId',
        'isActive',
        'twoFactorEnabled',
        'createdAt'
      ]
    });

    req.auditResourceType = 'self-profile';
    res.json({ user, settings: req.selfSettings });
  } catch (error) {
    console.error('Self profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const latestActivity = await Activity.findOne({
      where: { userId: req.user.userId },
      order: [['timestamp', 'DESC']]
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayActivityCount = await Activity.count({
      where: {
        userId: req.user.userId,
        timestamp: { [Op.gte]: todayStart }
      }
    });

    const screenshotCount = await Screenshot.count({
      where: { userId: req.user.userId }
    });

    req.auditResourceType = 'self-overview';
    res.json({
      latestActivity,
      todayActivityCount,
      screenshotCount
    });
  } catch (error) {
    console.error('Self overview error:', error);
    res.status(500).json({ error: 'Failed to fetch self overview' });
  }
});

router.get('/activities', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
    const where = { userId: req.user.userId };

    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) where.timestamp[Op.gte] = parseDateBoundary(req.query.startDate, 'start');
      if (req.query.endDate) where.timestamp[Op.lte] = parseDateBoundary(req.query.endDate, 'end');
    }

    const { count, rows } = await Activity.findAndCountAll({
      where,
      order: [['timestamp', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });

    req.auditResourceType = 'self-activities';
    res.json({
      activities: rows,
      total: count,
      page,
      totalPages: Math.max(Math.ceil(count / limit), 1)
    });
  } catch (error) {
    console.error('Self activities error:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

router.get('/screenshots', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const where = { userId: req.user.userId };

    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) where.timestamp[Op.gte] = parseDateBoundary(req.query.startDate, 'start');
      if (req.query.endDate) where.timestamp[Op.lte] = parseDateBoundary(req.query.endDate, 'end');
    }

    const { count, rows } = await Screenshot.findAndCountAll({
      where,
      order: [['timestamp', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });

    const screenshots = await Promise.all(rows.map(async (item) => ({
      ...item.toJSON(),
      signedUrl: await getSignedUrl(item.filePath, 3600)
    })));

    req.auditResourceType = 'self-screenshots';
    res.json({
      screenshots,
      total: count,
      page,
      totalPages: Math.max(Math.ceil(count / limit), 1)
    });
  } catch (error) {
    console.error('Self screenshots error:', error);
    res.status(500).json({ error: 'Failed to fetch screenshots' });
  }
});

router.get('/category-rules', async (req, res) => {
  try {
    req.auditResourceType = 'self-category-rules';
    res.json({ rules: await listCategoryRules() });
  } catch (error) {
    console.error('Self category rules error:', error);
    res.status(500).json({ error: 'Failed to fetch category rules' });
  }
});

router.get('/timesheets', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const timesheet = await buildTimesheetSummary(req.user.userId, startDate, endDate);
    req.auditResourceType = 'self-timesheets';
    res.json({
      startDate,
      endDate,
      ...timesheet
    });
  } catch (error) {
    console.error('Self timesheet error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

router.get('/2fa/status', async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, {
      attributes: ['twoFactorEnabled']
    });
    req.auditResourceType = 'self-2fa';
    res.json({ enabled: Boolean(user?.twoFactorEnabled) });
  } catch (error) {
    console.error('2FA status error:', error);
    res.status(500).json({ error: 'Failed to fetch 2FA status' });
  }
});

router.post('/2fa/setup', async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, {
      attributes: ['id', 'email', 'name']
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const secret = authenticator.generateSecret();
    const issuer = req.selfSettings.companyName || 'Employee Monitor';
    const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await setCache(`2fa:setup:${user.id}`, { secret }, 600);

    req.auditResourceType = 'self-2fa';
    req.auditAction = 'setup';
    res.json({
      otpauthUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Failed to start 2FA setup' });
  }
});

router.post('/2fa/enable', async (req, res) => {
  try {
    const pending = await getCache(`2fa:setup:${req.user.userId}`);
    if (!pending?.secret) {
      return res.status(400).json({ error: 'No pending 2FA setup found' });
    }

    const code = String(req.body?.code || '').replace(/\s+/g, '');
    if (!authenticator.check(code, pending.secret)) {
      return res.status(400).json({ error: 'Invalid authenticator code' });
    }

    const user = await User.findByPk(req.user.userId);
    user.twoFactorSecret = pending.secret;
    user.twoFactorEnabled = true;
    await user.save();
    await deleteCache(`2fa:setup:${req.user.userId}`);

    await logAuditEvent({
      userId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'enable-2fa',
      resourceType: 'self-2fa',
      method: 'POST',
      path: '/api/self/2fa/enable',
      ipAddress: req.ip,
      statusCode: 200,
      metadata: {}
    });

    res.json({ enabled: true });
  } catch (error) {
    console.error('2FA enable error:', error);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

router.post('/2fa/disable', async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = await User.findByPk(req.user.userId);

    if (!password || !user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is required to disable 2FA' });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await user.save();

    await logAuditEvent({
      userId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'disable-2fa',
      resourceType: 'self-2fa',
      method: 'POST',
      path: '/api/self/2fa/disable',
      ipAddress: req.ip,
      statusCode: 200,
      metadata: {}
    });

    res.json({ enabled: false });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

module.exports = router;
