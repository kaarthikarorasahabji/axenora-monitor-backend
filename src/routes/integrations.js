const express = require('express');
const { User } = require('../models');
const { buildAdvancedAnalytics } = require('../services/analytics');
const { buildTimesheetSummary } = require('../services/timesheets');
const { apiTokenAuth } = require('../middleware/apiTokenAuth');

const router = express.Router();

// Scoped key used by sibling services (e.g. the CRM) to verify that an
// employee is registered on the Monitor before onboarding them into the CRM.
// Kept separate from ApiToken so it can be rotated without DB writes.
const INTEGRATION_API_KEY = (process.env.INTEGRATION_API_KEY || '').trim();

function integrationKeyAuth(req, res, next) {
  if (!INTEGRATION_API_KEY) {
    // Misconfiguration — fail closed so misuse is obvious in logs.
    return res.status(503).json({ error: 'Integration key not configured on server' });
  }
  const provided = String(req.headers['x-integration-key'] || '').trim();
  if (!provided || provided !== INTEGRATION_API_KEY) {
    return res.status(401).json({ error: 'Invalid integration key' });
  }
  return next();
}

// Lightweight lookup endpoint for the CRM onboarding gate. Returns only the
// minimal identity fields needed to decide whether to admit a user — no PII
// beyond what the CRM already knows.
router.get('/employee-lookup', integrationKeyAuth, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'email query param required' });
    }
    const user = await User.findOne({
      where: { email },
      attributes: ['id', 'email', 'name', 'isActive', 'machineId', 'role', 'department', 'brand'],
    });
    if (!user) {
      return res.status(404).json({ found: false });
    }
    return res.json({
      found: true,
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: Boolean(user.isActive),
      machineId: user.machineId || null,
      role: user.role || null,
      department: user.department || null,
      brand: user.brand || null,
    });
  } catch (error) {
    console.error('Integration employee-lookup error:', error);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

// Remaining endpoints use the older per-user ApiToken model.
router.use(apiTokenAuth);

router.get('/analytics', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
    }

    const analytics = await buildAdvancedAnalytics(employeeId, startDate, endDate);
    res.json({
      source: 'api-token',
      analytics
    });
  } catch (error) {
    console.error('Integration analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/timesheets', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
    }

    const timesheet = await buildTimesheetSummary(employeeId, startDate, endDate);
    res.json({
      source: 'api-token',
      timesheet
    });
  } catch (error) {
    console.error('Integration timesheet error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

module.exports = router;
