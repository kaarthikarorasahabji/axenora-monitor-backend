const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op, fn, col, literal } = require('sequelize');
const {
  User,
  AppCategoryRule,
  AuditLog,
  Activity,
  Screenshot,
  ApiToken,
  Alert,
  AttendanceSession,
  AttendanceDaily,
  EmployeeShift,
  Recording,
  LeaveRequest
} = require('../models');
const { updateSettings, getSettings } = require('../services/settings');
const { isEmployeeOnline, getRedisClient } = require('../services/redis');
const { buildTimesheetSummary } = require('../services/timesheets');
const { applyRetentionPolicies } = require('../services/retention');
const { buildAdvancedAnalytics } = require('../services/analytics');
const { parseDateBoundary } = require('../utils/dateRange');
const { sendAgentInviteEmail } = require('../services/email');

const router = express.Router();

const REG_CODE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

async function getRegistrationCodeForEmployee(employeeId) {
  const redis = getRedisClient();
  const code = await redis.get(`regcode:employee:${employeeId}`);
  if (!code) return null;

  const mappedEmployeeId = await redis.get(`regcode:${code}`);
  if (String(mappedEmployeeId || '') !== String(employeeId)) {
    return null;
  }

  return code;
}

async function generateRegistrationCode(employeeId) {
  const redis = getRedisClient();
  const existingCode = await redis.get(`regcode:employee:${employeeId}`);
  if (existingCode) {
    await redis.del(`regcode:${existingCode}`);
  }

  const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex code
  await redis.set(`regcode:${code}`, employeeId, { EX: REG_CODE_TTL });
  await redis.set(`regcode:employee:${employeeId}`, code, { EX: REG_CODE_TTL });
  return code;
}

function serializeUser(user) {
  const json = user.toJSON();
  delete json.passwordHash;
  delete json.twoFactorSecret;
  return json;
}

async function removeEmployeeAndData(employee) {
  const employeeId = employee.id;
  const machineId = employee.machineId;

  await Promise.all([
    Screenshot.destroy({ where: { userId: employeeId } }),
    Activity.destroy({ where: { userId: employeeId } }),
    Alert.destroy({ where: { employeeId } }),
    AttendanceSession.destroy({ where: { employeeId } }),
    AttendanceDaily.destroy({ where: { employeeId } }),
    EmployeeShift.destroy({ where: { employeeId } }),
    Recording.destroy({ where: { [Op.or]: [{ employeeId }, { adminId: employeeId }] } }),
    LeaveRequest.destroy({ where: { [Op.or]: [{ employeeId }, { reviewedBy: employeeId }] } }),
    ApiToken.destroy({ where: { createdByUserId: employeeId } }),
    AuditLog.destroy({ where: { userId: employeeId } }),
  ]);

  try {
    const redis = getRedisClient();
    const registrationCode = await getRegistrationCodeForEmployee(employeeId);
    const redisKeys = [`regcode:employee:${employeeId}`];
    if (registrationCode) redisKeys.push(`regcode:${registrationCode}`);
    if (machineId) redisKeys.push(`online:${machineId}`);
    if (redisKeys.length) await redis.del(redisKeys);
  } catch (error) {
    console.warn(`Monitor cleanup Redis warning for employee ${employeeId}:`, error.message);
  }

  await employee.destroy();
}

function toCsv(headers, rows) {
  const escape = (value) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };

  return [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
}

router.get('/employees', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const search = String(req.query.search || '').trim();
    const brand = String(req.query.brand || '').trim();
    const offset = (page - 1) * limit;

    const where = { role: 'employee' };
    if (brand) where.brand = brand;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { machineId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    // Check online status for each employee
    const employees = await Promise.all(
      rows.map(async (user) => {
        const data = serializeUser(user);
        data.isOnline = user.machineId ? await isEmployeeOnline(user.machineId) : false;
        data.registrationCode = await getRegistrationCodeForEmployee(user.id);
        return data;
      })
    );

    req.auditResourceType = 'employees';
    res.json({
      employees,
      total: count,
      page,
      totalPages: Math.max(Math.ceil(count / limit), 1)
    });
  } catch (error) {
    console.error('Admin employee list error:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

router.post('/employees', async (req, res) => {
  try {
    const { name, email, password, department, brand, machineId, isActive = true } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      const registrationCode = await generateRegistrationCode(existing.id);
      return res.status(200).json({
        employee: serializeUser(existing),
        registrationCode,
        emailSent: false,
        reused: true,
        message: 'Employee already exists; returning existing monitoring profile.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const employee = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role: 'employee',
      department: department || null,
      brand: brand || null,
      machineId: machineId || null,
      isActive: Boolean(isActive)
    });

    const registrationCode = await generateRegistrationCode(employee.id);

    // Auto-send invite email with download link + code (fire and forget)
    sendAgentInviteEmail({
      to: email,
      employeeName: name,
      registrationCode,
    }).then(r => {
      if (r.success) console.log(`Invite email auto-sent to ${email}`);
      else console.warn(`Invite email failed for ${email}: ${r.error}`);
    }).catch(err => console.warn(`Invite email error for ${email}:`, err.message));

    req.auditResourceType = 'employees';
    req.auditAction = 'create';
    res.status(201).json({ employee: serializeUser(employee), registrationCode, emailSent: true });
  } catch (error) {
    console.error('Admin employee create error:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.post('/employees/import', async (req, res) => {
  try {
    const records = Array.isArray(req.body?.employees) ? req.body.employees : [];
    if (records.length === 0) {
      return res.status(400).json({ error: 'employees array is required' });
    }

    const results = [];

    for (const record of records) {
      const name = String(record.name || '').trim();
      const email = String(record.email || '').trim().toLowerCase();
      const password = String(record.password || '').trim();
      const department = String(record.department || '').trim() || null;
      const machineId = String(record.machineId || '').trim();
      const isActive = record.isActive !== false;

      if (!name || !email || !password) {
        results.push({ email, status: 'skipped', reason: 'Missing required fields' });
        continue;
      }

      const existing = await User.findOne({ where: { email } });
      const passwordHash = await bcrypt.hash(password, 12);

      if (existing) {
        await existing.update({
          name,
          passwordHash,
          department,
          machineId: machineId || null,
          isActive
        });
        results.push({ email, status: 'updated', id: existing.id });
      } else {
        const employee = await User.create({
          name,
          email,
          passwordHash,
          role: 'employee',
          department,
          machineId: machineId || null,
          isActive
        });
        results.push({ email, status: 'created', id: employee.id });
      }
    }

    req.auditResourceType = 'employees';
    req.auditAction = 'bulk-import';
    res.json({
      total: records.length,
      created: results.filter((item) => item.status === 'created').length,
      updated: results.filter((item) => item.status === 'updated').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
      results
    });
  } catch (error) {
    console.error('Admin employee import error:', error);
    res.status(500).json({ error: 'Failed to import employees' });
  }
});

router.put('/employees/:id', async (req, res) => {
  try {
    const employee = await User.findOne({
      where: { id: req.params.id, role: 'employee' }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const { name, email, password, department, machineId, isActive } = req.body;

    if (name !== undefined) employee.name = name;
    if (email !== undefined) employee.email = email;
    if (department !== undefined) employee.department = department || null;
    if (machineId !== undefined) employee.machineId = machineId || null;
    if (isActive !== undefined) employee.isActive = Boolean(isActive);
    if (password) employee.passwordHash = await bcrypt.hash(password, 12);

    await employee.save();

    req.auditResourceType = 'employees';
    req.auditAction = 'update';
    res.json({ employee: serializeUser(employee) });
  } catch (error) {
    console.error('Admin employee update error:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

router.post('/employees/bulk', async (req, res) => {
  try {
    const { ids = [], action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || !action) {
      return res.status(400).json({ error: 'ids and action are required' });
    }

    const employees = await User.findAll({
      where: { id: { [Op.in]: ids }, role: 'employee' }
    });

    if (action === 'activate') {
      await Promise.all(employees.map((employee) => employee.update({ isActive: true })));
    } else if (action === 'deactivate') {
      await Promise.all(employees.map((employee) => employee.update({ isActive: false })));
    } else if (action === 'delete') {
      await Promise.all(employees.map((employee) => removeEmployeeAndData(employee)));
    } else if (action === 'regenerateApiKeys') {
      await Promise.all(employees.map((employee) => employee.update({
        apiKey: crypto.randomBytes(32).toString('hex')
      })));
    } else {
      return res.status(400).json({ error: 'Unsupported bulk action' });
    }

    req.auditResourceType = 'employees';
    req.auditAction = 'bulk-update';
    res.json({ processed: employees.length, action });
  } catch (error) {
    console.error('Admin employee bulk action error:', error);
    res.status(500).json({ error: 'Failed to run bulk action' });
  }
});

router.delete('/employees/:id', async (req, res) => {
  try {
    const employee = await User.findOne({
      where: { id: req.params.id, role: 'employee' }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    await removeEmployeeAndData(employee);
    req.auditResourceType = 'employees';
    req.auditAction = 'delete';
    res.json({ message: 'Employee deleted' });
  } catch (error) {
    console.error('Admin employee delete error:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

router.post('/employees/:id/regenerate-api-key', async (req, res) => {
  try {
    const employee = await User.findOne({
      where: { id: req.params.id, role: 'employee' }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    employee.apiKey = crypto.randomBytes(32).toString('hex');
    await employee.save();

    const registrationCode = await generateRegistrationCode(employee.id);

    req.auditResourceType = 'employees';
    req.auditAction = 'update';
    res.json({ registrationCode });
  } catch (error) {
    console.error('Admin employee API key error:', error);
    res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

router.post('/employees/:id/send-invite', async (req, res) => {
  try {
    const employee = await User.findOne({
      where: { id: req.params.id, role: 'employee' }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Generate a fresh registration code
    const registrationCode = await generateRegistrationCode(employee.id);

    sendAgentInviteEmail({
      to: employee.email,
      employeeName: employee.name,
      registrationCode,
    }).then(result => {
      if (result.success) console.log(`Invite email sent to ${employee.email}`);
      else console.warn(`Invite email failed for ${employee.email}: ${result.error}`);
    }).catch(err => console.warn(`Invite email error for ${employee.email}:`, err.message));

    req.auditResourceType = 'employees';
    req.auditAction = 'send-invite';
    res.json({ message: 'Invite email queued', registrationCode, emailQueued: true });
  } catch (error) {
    console.error('Admin send invite error:', error);
    res.status(500).json({ error: 'Failed to send invite email' });
  }
});

router.get('/employees/export', async (req, res) => {
  try {
    const employees = await User.findAll({
      where: { role: 'employee' },
      order: [['name', 'ASC']]
    });

    const csv = toCsv(
      ['Name', 'Email', 'Machine ID', 'Status', 'Created At'],
      employees.map((employee) => [
        employee.name,
        employee.email,
        employee.machineId || '',
        employee.isActive ? 'Active' : 'Disabled',
        employee.createdAt.toISOString()
      ])
    );

    req.auditResourceType = 'employees';
    req.auditAction = 'export';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Employee export error:', error);
    res.status(500).json({ error: 'Failed to export employees' });
  }
});

router.get('/category-rules', async (req, res) => {
  try {
    const rules = await AppCategoryRule.findAll({
      order: [['priority', 'ASC'], ['keyword', 'ASC']]
    });
    req.auditResourceType = 'category-rules';
    res.json({ rules });
  } catch (error) {
    console.error('Category rules fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch category rules' });
  }
});

router.post('/category-rules', async (req, res) => {
  try {
    const { keyword, category, priority = 100, isActive = true } = req.body;
    if (!keyword || !category) {
      return res.status(400).json({ error: 'keyword and category are required' });
    }

    const rule = await AppCategoryRule.create({
      keyword,
      category,
      priority,
      isActive
    });

    req.auditResourceType = 'category-rules';
    req.auditAction = 'create';
    res.status(201).json({ rule });
  } catch (error) {
    console.error('Category rule create error:', error);
    res.status(500).json({ error: 'Failed to create category rule' });
  }
});

router.put('/category-rules/:id', async (req, res) => {
  try {
    const rule = await AppCategoryRule.findByPk(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Category rule not found' });
    }

    const { keyword, category, priority, isActive } = req.body;
    if (keyword !== undefined) rule.keyword = keyword;
    if (category !== undefined) rule.category = category;
    if (priority !== undefined) rule.priority = Number(priority);
    if (isActive !== undefined) rule.isActive = Boolean(isActive);
    await rule.save();

    req.auditResourceType = 'category-rules';
    req.auditAction = 'update';
    res.json({ rule });
  } catch (error) {
    console.error('Category rule update error:', error);
    res.status(500).json({ error: 'Failed to update category rule' });
  }
});

router.delete('/category-rules/:id', async (req, res) => {
  try {
    const rule = await AppCategoryRule.findByPk(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Category rule not found' });
    }

    await rule.destroy();
    req.auditResourceType = 'category-rules';
    req.auditAction = 'delete';
    res.json({ message: 'Category rule deleted' });
  } catch (error) {
    console.error('Category rule delete error:', error);
    res.status(500).json({ error: 'Failed to delete category rule' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    req.auditResourceType = 'settings';
    res.json({ settings: await getSettings() });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await updateSettings(req.body || {});
    req.auditResourceType = 'settings';
    req.auditAction = 'update';
    res.json({ settings });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(400).json({ error: error.message || 'Failed to update settings' });
  }
});

router.post('/retention/run', async (req, res) => {
  try {
    const result = await applyRetentionPolicies();
    req.auditResourceType = 'retention';
    req.auditAction = 'run';
    res.json({ result });
  } catch (error) {
    console.error('Retention cleanup error:', error);
    res.status(500).json({ error: 'Failed to run retention cleanup' });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const search = String(req.query.search || '').trim();
    const offset = (page - 1) * limit;

    const where = {};
    if (search) {
      where[Op.or] = [
        { actorEmail: { [Op.iLike]: `%${search}%` } },
        { action: { [Op.iLike]: `%${search}%` } },
        { resourceType: { [Op.iLike]: `%${search}%` } },
        { path: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    req.auditResourceType = 'audit-logs';
    res.json({
      logs: rows,
      total: count,
      page,
      totalPages: Math.max(Math.ceil(count / limit), 1)
    });
  } catch (error) {
    console.error('Audit logs fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.get('/timesheets', async (req, res) => {
  try {
    const employeeId = req.query.employeeId || req.query.userId;
    const { startDate, endDate } = req.query;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
    }

    const employee = await User.findOne({
      where: { id: employeeId, role: 'employee' },
      attributes: ['id', 'name', 'email']
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const timesheet = await buildTimesheetSummary(employeeId, startDate, endDate);
    req.auditResourceType = 'timesheets';
    res.json({
      employee,
      startDate,
      endDate,
      ...timesheet
    });
  } catch (error) {
    console.error('Admin timesheet error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
    }

    const analytics = await buildAdvancedAnalytics(employeeId, startDate, endDate);
    req.auditResourceType = 'analytics';
    res.json(analytics);
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({ error: 'Failed to build analytics' });
  }
});

router.post('/custom-reports/generate', async (req, res) => {
  try {
    const { employeeId, startDate, endDate, sections = [] } = req.body || {};
    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
    }

    const response = {
      employeeId,
      startDate,
      endDate,
      sections: {}
    };

    if (sections.includes('timesheet')) {
      response.sections.timesheet = await buildTimesheetSummary(employeeId, startDate, endDate);
    }

    if (sections.includes('analytics')) {
      response.sections.analytics = await buildAdvancedAnalytics(employeeId, startDate, endDate);
    }

    if (sections.includes('activitySummary')) {
      response.sections.activitySummary = await Activity.findAll({
        where: {
          userId: employeeId,
          timestamp: {
            [Op.gte]: parseDateBoundary(startDate, 'start'),
            [Op.lte]: parseDateBoundary(endDate, 'end')
          }
        },
        attributes: ['activeApp', 'windowTitle', 'timestamp', 'idleSeconds'],
        order: [['timestamp', 'ASC']],
        limit: 500
      });
    }

    if (sections.includes('screenshotSummary')) {
      response.sections.screenshotSummary = await Screenshot.findAll({
        where: {
          userId: employeeId,
          timestamp: {
            [Op.gte]: parseDateBoundary(startDate, 'start'),
            [Op.lte]: parseDateBoundary(endDate, 'end')
          }
        },
        attributes: ['id', 'timestamp', 'fileSize'],
        order: [['timestamp', 'DESC']],
        limit: 200
      });
    }

    req.auditResourceType = 'custom-reports';
    req.auditAction = 'generate';
    res.json(response);
  } catch (error) {
    console.error('Custom report generation error:', error);
    res.status(500).json({ error: 'Failed to generate custom report' });
  }
});

router.get('/api-tokens', async (req, res) => {
  try {
    const tokens = await ApiToken.findAll({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'label', 'scopes', 'isActive', 'lastUsedAt', 'createdAt']
    });

    req.auditResourceType = 'api-tokens';
    res.json({ tokens });
  } catch (error) {
    console.error('API token list error:', error);
    res.status(500).json({ error: 'Failed to fetch API tokens' });
  }
});

router.post('/api-tokens', async (req, res) => {
  try {
    const { label, scopes = ['read:analytics'] } = req.body || {};
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');

    const token = await ApiToken.create({
      label,
      scopes,
      tokenHash,
      createdByUserId: req.user.userId
    });

    req.auditResourceType = 'api-tokens';
    req.auditAction = 'create';
    res.status(201).json({
      token: {
        id: token.id,
        label: token.label,
        scopes: token.scopes
      },
      plainToken
    });
  } catch (error) {
    console.error('API token create error:', error);
    res.status(500).json({ error: 'Failed to create API token' });
  }
});

// Multi-brand summary — counts of active employees per brand, useful for
// dashboards that want to show "Thai Naturals: 18 active / Kerala: 12 active".
router.get('/brands/summary', async (req, res) => {
  try {
    const rows = await User.findAll({
      attributes: [
        [col('brand'), 'brand'],
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', literal('CASE WHEN is_active THEN 1 ELSE 0 END')), 'active'],
      ],
      where: { role: 'employee' },
      group: ['brand'],
      raw: true,
    });
    const summary = rows.map((r) => ({
      brand: r.brand || 'unassigned',
      total: parseInt(r.total, 10) || 0,
      active: parseInt(r.active, 10) || 0,
    }));
    res.json({ brands: summary });
  } catch (error) {
    console.error('Admin brand summary error:', error);
    res.status(500).json({ error: 'Failed to build brand summary' });
  }
});

router.delete('/api-tokens/:id', async (req, res) => {
  try {
    const token = await ApiToken.findByPk(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'API token not found' });
    }

    await token.destroy();
    req.auditResourceType = 'api-tokens';
    req.auditAction = 'delete';
    res.json({ message: 'API token deleted' });
  } catch (error) {
    console.error('API token delete error:', error);
    res.status(500).json({ error: 'Failed to delete API token' });
  }
});

module.exports = router;
