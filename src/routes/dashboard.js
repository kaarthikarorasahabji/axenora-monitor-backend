/**
 * Dashboard routes
 * Employee list, activities, screenshots, reports
 */

const express = require('express');
const { Op } = require('sequelize');
const { User, Activity, Screenshot } = require('../models');
const { getObjectStream, getSignedUrl } = require('../services/storage');
const { getOnlinePresenceList, getCache, setCache } = require('../services/redis');
const { getLatestFrameMeta } = require('../services/liveFrames');
const { parseDateBoundary } = require('../utils/dateRange');

const router = express.Router();

async function streamStoredObject(res, objectKey, { contentType = 'application/octet-stream', downloadName = null } = {}) {
  try {
    const objectStream = await getObjectStream(objectKey);
    if (!objectStream) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.setHeader('Content-Type', contentType);
    if (downloadName) {
      res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    }
    objectStream.on('error', (error) => {
      console.error('Object stream error:', error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to stream asset' });
      } else {
        res.end();
      }
    });
    objectStream.pipe(res);
  } catch (error) {
    console.error('Object fetch error:', error);
    return res.status(404).json({ error: 'Asset not found' });
  }
}

// GET /api/employees - List all employees with online status
router.get('/employees', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
    const offset = (page - 1) * limit;

    const { count: total, rows: employees } = await User.findAndCountAll({
      where: { role: 'employee' },
      attributes: ['id', 'name', 'email', 'machineId', 'isActive', 'createdAt'],
      limit,
      offset,
      order: [['name', 'ASC']]
    });
    
    const presenceRows = await getOnlinePresenceList();
    const onlineMachineIds = presenceRows.map((row) => row.machineId || row.machine_id).filter(Boolean);
    const presenceByMachine = new Map(
      presenceRows.map((row) => [row.machineId || row.machine_id, row])
    );
    const onlineCount = await User.count({
      where: {
        role: 'employee',
        machineId: {
          [Op.in]: onlineMachineIds
        }
      }
    });
    
    const employeesWithStatus = await Promise.all(
      employees.map(async (emp) => {
        const presence = emp.machineId ? presenceByMachine.get(emp.machineId) : null;
        const isOnline = Boolean(emp.machineId && presence);
        const latestFrame = emp.machineId ? getLatestFrameMeta(emp.machineId) : null;
        
        const latestActivity = await Activity.findOne({
          where: { userId: emp.id },
          order: [['timestamp', 'DESC']],
          limit: 1,
          attributes: ['activeApp', 'windowTitle', 'url', 'timestamp']
        });
        
        return {
          ...emp.toJSON(),
          isOnline,
          online: isOnline,
          presence,
          latestFrame,
          hasLatestFrame: Boolean(latestFrame),
          latestFrameAt: latestFrame?.timestamp || null,
          latestFrameAgeMs: latestFrame?.latestFrameAgeMs ?? null,
          latestActivity
        };
      })
    );
    
    res.json({
      employees: employeesWithStatus,
      total,
      onlineCount,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1)
    });
    
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET /api/employees/:id/activities - Paginated activity log
router.get('/employees/:id/activities', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      page = 1, 
      limit = 50, 
      startDate, 
      endDate 
    } = req.query;
    
    const where = { userId: id };
    
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[Op.gte] = parseDateBoundary(startDate, 'start');
      if (endDate) where.timestamp[Op.lte] = parseDateBoundary(endDate, 'end');
    }
    
    const offset = (page - 1) * limit;
    
    const { count, rows: activities } = await Activity.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });
    
    res.json({
      activities,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
    
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// GET /api/employees/:id/screenshots - Paginated screenshots with signed URLs
router.get('/employees/:id/screenshots', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      page = 1, 
      limit = 30, 
      startDate, 
      endDate 
    } = req.query;
    
    const where = { userId: id };
    
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[Op.gte] = parseDateBoundary(startDate, 'start');
      if (endDate) where.timestamp[Op.lte] = parseDateBoundary(endDate, 'end');
    }
    
    const offset = (page - 1) * limit;
    
    const { count, rows: screenshots } = await Screenshot.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });
    
    // Generate signed URLs
    const screenshotsWithUrls = await Promise.all(
      screenshots.map(async (ss) => {
        const signedUrl = await getSignedUrl(ss.filePath, 3600);
        return {
          ...ss.toJSON(),
          signedUrl
        };
      })
    );
    
    res.json({
      screenshots: screenshotsWithUrls,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
    
  } catch (error) {
    console.error('Get screenshots error:', error);
    res.status(500).json({ error: 'Failed to fetch screenshots' });
  }
});

// GET /api/screenshots/:id/file - Stream screenshot binary through the monitor backend
router.get('/screenshots/:id/file', async (req, res) => {
  try {
    const screenshot = await Screenshot.findByPk(req.params.id);
    if (!screenshot?.filePath) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    return streamStoredObject(res, screenshot.filePath, {
      contentType: 'image/jpeg',
      downloadName: `${screenshot.machineId || 'employee'}-${screenshot.id}.jpg`,
    });
  } catch (error) {
    console.error('Screenshot file stream error:', error);
    res.status(500).json({ error: 'Failed to stream screenshot' });
  }
});

// GET /api/employees/:id/report - Productivity aggregate by day
router.get('/employees/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required' });
    }

    const cacheKey = `report:${id}:${startDate}:${endDate}`;
    const cachedReport = await getCache(cacheKey);

    if (cachedReport) {
      return res.json(cachedReport);
    }
    
    // Get activities in date range
    const activities = await Activity.findAll({
      where: {
        userId: id,
        timestamp: {
          [Op.gte]: parseDateBoundary(startDate, 'start'),
          [Op.lte]: parseDateBoundary(endDate, 'end')
        }
      },
      order: [['timestamp', 'ASC']]
    });
    
    // Aggregate by day
    const dailyStats = {};
    
    activities.forEach(activity => {
      const day = activity.timestamp.toISOString().split('T')[0];
      
      if (!dailyStats[day]) {
        dailyStats[day] = {
          date: day,
          totalSeconds: 0,
          activeSeconds: 0,
          idleSeconds: 0,
          apps: {},
          activityCount: 0
        };
      }
      
      const interval = 10; // seconds between activity checks
      dailyStats[day].totalSeconds += interval;
      dailyStats[day].activityCount += 1;
      
      if (activity.idleSeconds < 60) {
        dailyStats[day].activeSeconds += interval;
      } else {
        dailyStats[day].idleSeconds += interval;
      }
      
      // Track app usage
      if (activity.activeApp) {
        if (!dailyStats[day].apps[activity.activeApp]) {
          dailyStats[day].apps[activity.activeApp] = 0;
        }
        dailyStats[day].apps[activity.activeApp] += interval;
      }
    });
    
    // Calculate productivity scores
    const report = Object.values(dailyStats).map(day => {
      const productivityScore = day.totalSeconds > 0 
        ? Math.round((day.activeSeconds / day.totalSeconds) * 100)
        : 0;
      
      // Get top app
      const topApp = Object.entries(day.apps)
        .sort((a, b) => b[1] - a[1])[0];
      
      return {
        date: day.date,
        productivityScore,
        activeHours: Math.round(day.activeSeconds / 3600 * 100) / 100,
        idlePercentage: day.totalSeconds > 0 
          ? Math.round((day.idleSeconds / day.totalSeconds) * 100)
          : 0,
        topApp: topApp ? { name: topApp[0], seconds: topApp[1] } : null,
        activityCount: day.activityCount
      };
    });
    
    const payload = {
      startDate,
      endDate,
      report,
      summary: {
        totalDays: report.length,
        avgProductivityScore: report.length > 0
          ? Math.round(report.reduce((sum, r) => sum + r.productivityScore, 0) / report.length)
          : 0
      }
    };

    await setCache(cacheKey, payload, 300);
    res.json(payload);
    
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/live - Currently online machine IDs
router.get('/live', async (req, res) => {
  try {
    const presenceRows = await getOnlinePresenceList();
    const onlineMachineIds = presenceRows.map((row) => row.machineId || row.machine_id).filter(Boolean);
    const presenceByMachine = new Map(
      presenceRows.map((row) => [row.machineId || row.machine_id, row])
    );
    
    const onlineEmployees = await User.findAll({
      where: {
        machineId: {
          [Op.in]: onlineMachineIds
        }
      },
      attributes: ['id', 'name', 'email', 'machineId']
    });
    
    res.json({
      online: onlineEmployees.map((employee) => {
        const row = employee.toJSON();
        const latestFrame = getLatestFrameMeta(row.machineId);
        return {
          ...row,
          isOnline: true,
          online: true,
          presence: presenceByMachine.get(row.machineId) || null,
          latestFrame,
          hasLatestFrame: Boolean(latestFrame),
          latestFrameAt: latestFrame?.timestamp || null,
          latestFrameAgeMs: latestFrame?.latestFrameAgeMs ?? null,
        };
      }),
      count: onlineEmployees.length
    });
    
  } catch (error) {
    console.error('Get live employees error:', error);
    res.status(500).json({ error: 'Failed to fetch live employees' });
  }
});

module.exports = router;
