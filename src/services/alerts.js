/**
 * Alert generation service
 * Real-time alerts via WebSocket + scheduled checks for idle/absent
 */

const { Op } = require('sequelize');
const { User, Activity, Alert, BlockedSite, BlockedApp } = require('../models');
const { getOnlineMachineIds } = require('./redis');
const { getSettings } = require('./settings');

// Cache blocked lists (refreshed every 60s)
let _blockedSites = [];
let _blockedApps = [];
let _lastBlocklistRefresh = 0;
const BLOCKLIST_CACHE_TTL = 60 * 1000; // 60 seconds

async function getBlocklists() {
  const now = Date.now();
  if (now - _lastBlocklistRefresh > BLOCKLIST_CACHE_TTL) {
    const [sites, apps] = await Promise.all([
      BlockedSite.findAll({ where: { isActive: true } }),
      BlockedApp.findAll({ where: { isActive: true } })
    ]);
    _blockedSites = sites;
    _blockedApps = apps;
    _lastBlocklistRefresh = now;
  }
  return { blockedSites: _blockedSites, blockedApps: _blockedApps };
}

/**
 * Check a single app_change event against blocklists instantly.
 * Returns alert object if blocked, null otherwise.
 */
async function checkRealtimeBlacklist(employeeId, employeeName, machineId, activeApp, url) {
  const { blockedSites, blockedApps } = await getBlocklists();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  // Check blocked websites
  if (url) {
    for (const site of blockedSites) {
      if (url.toLowerCase().includes(site.urlPattern.toLowerCase())) {
        const existing = await Alert.findOne({
          where: {
            employeeId,
            alertType: 'blacklist',
            createdAt: { [Op.gte]: thirtyMinAgo },
            message: { [Op.like]: `%${site.urlPattern}%` }
          }
        });
        if (!existing) {
          return Alert.create({
            employeeId,
            alertType: 'blacklist',
            severity: 'high',
            message: `${employeeName} visited blocked site matching "${site.urlPattern}"`,
            metadata: { machineId, url, pattern: site.urlPattern, reason: site.reason }
          });
        }
        return null;
      }
    }
  }

  // Check blocked apps
  if (activeApp) {
    for (const app of blockedApps) {
      if (activeApp.toLowerCase().includes(app.processName.toLowerCase())) {
        const existing = await Alert.findOne({
          where: {
            employeeId,
            alertType: 'blacklist',
            createdAt: { [Op.gte]: thirtyMinAgo },
            message: { [Op.like]: `%${app.processName}%` }
          }
        });
        if (!existing) {
          return Alert.create({
            employeeId,
            alertType: 'blacklist',
            severity: 'high',
            message: `${employeeName} used blocked app "${app.processName}"`,
            metadata: { machineId, activeApp, processName: app.processName, reason: app.reason }
          });
        }
        return null;
      }
    }
  }

  return null;
}

/**
 * Create an idle alert for an employee (called from WebSocket handler)
 */
async function createIdleAlert(employeeId, employeeName, machineId, idleMinutes) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const existing = await Alert.findOne({
    where: {
      employeeId,
      alertType: 'idle',
      createdAt: { [Op.gte]: thirtyMinAgo }
    }
  });

  if (existing) return null;

  return Alert.create({
    employeeId,
    alertType: 'idle',
    severity: 'medium',
    message: `${employeeName} has been idle for ${idleMinutes} minutes`,
    metadata: { machineId, idleMinutes, detectedAt: new Date().toISOString() }
  });
}

/**
 * Scheduled: Check for idle employees (fallback — agents also send idle_alert in real-time)
 */
async function checkIdleAlerts(settings) {
  let created = 0;
  const thresholdSeconds = (settings.alertIdleThresholdMinutes || 15) * 60;
  const onlineMachineIds = await getOnlineMachineIds();

  if (onlineMachineIds.length === 0) return created;

  const employees = await User.findAll({
    where: {
      machineId: { [Op.in]: onlineMachineIds },
      role: 'employee',
      isActive: true
    }
  });

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  for (const emp of employees) {
    const lastActivity = await Activity.findOne({
      where: { userId: emp.id },
      order: [['timestamp', 'DESC']],
      limit: 1
    });

    if (!lastActivity) continue;
    if ((lastActivity.idleSeconds || 0) < thresholdSeconds) continue;

    const existing = await Alert.findOne({
      where: {
        employeeId: emp.id,
        alertType: 'idle',
        createdAt: { [Op.gte]: thirtyMinAgo }
      }
    });

    if (existing) continue;

    await Alert.create({
      employeeId: emp.id,
      alertType: 'idle',
      severity: 'medium',
      message: `${emp.name} has been idle for ${Math.round(lastActivity.idleSeconds / 60)} minutes`,
      metadata: {
        machineId: emp.machineId,
        idleSeconds: lastActivity.idleSeconds,
        lastActivityAt: lastActivity.timestamp
      }
    });
    created++;
  }

  return created;
}

/**
 * Scheduled: Check for absent employees (no activity today after 10 AM)
 */
async function checkAbsentAlerts() {
  let created = 0;
  const now = new Date();

  if (now.getHours() < 10) return created;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const employees = await User.findAll({
    where: {
      role: 'employee',
      isActive: true,
      machineId: { [Op.ne]: null }
    }
  });

  for (const emp of employees) {
    const activityCount = await Activity.count({
      where: {
        userId: emp.id,
        timestamp: { [Op.gte]: todayStart }
      }
    });

    if (activityCount > 0) continue;

    const existing = await Alert.findOne({
      where: {
        employeeId: emp.id,
        alertType: 'absent',
        createdAt: { [Op.gte]: thirtyMinAgo }
      }
    });

    if (existing) continue;

    await Alert.create({
      employeeId: emp.id,
      alertType: 'absent',
      severity: 'high',
      message: `${emp.name} has no activity recorded today`,
      metadata: { machineId: emp.machineId, checkedAt: now.toISOString() }
    });
    created++;
  }

  return created;
}

/**
 * Run scheduled alert checks (idle + absent only; blacklist is now real-time)
 */
async function runAlertChecks() {
  const settings = await getSettings();

  const [idleCount, absentCount] = await Promise.all([
    checkIdleAlerts(settings),
    checkAbsentAlerts()
  ]);

  const total = idleCount + absentCount;

  if (total > 0) {
    console.log(`Scheduled alert checks: ${idleCount} idle, ${absentCount} absent`);
  }

  return total;
}

module.exports = {
  runAlertChecks,
  checkIdleAlerts,
  checkAbsentAlerts,
  checkRealtimeBlacklist,
  createIdleAlert
};
