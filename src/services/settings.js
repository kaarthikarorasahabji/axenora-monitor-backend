const { Setting } = require('../models');

const DEFAULT_SETTINGS = {
  companyName: 'Employee Monitor',
  allowEmployeePortal: true,
  requireTwoFactorForAdmins: false,
  requireTwoFactorForEmployees: false,
  activityRetentionDays: 90,
  screenshotRetentionDays: 7,
  auditRetentionDays: 180,
  defaultIdleThresholdSeconds: 60,
  screenshotIntervalSeconds: 120,
  activityIntervalSeconds: 10,
  idleThresholdSeconds: 60,
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  recordingRetentionDays: 7,
  maxConcurrentLiveSessions: 10,
  maxConcurrentRecordings: 3,
  alertIdleThresholdMinutes: 15,
  alertProductivityThreshold: 30,
  stealthModeDefault: false,
  breakDetectionMinutes: 5,
  overtimeAlertEnabled: true
};

function normalizeSettingValue(key, value) {
  const numericKeys = new Set([
    'activityRetentionDays',
    'screenshotRetentionDays',
    'auditRetentionDays',
    'defaultIdleThresholdSeconds',
    'screenshotIntervalSeconds',
    'activityIntervalSeconds',
    'idleThresholdSeconds',
    'recordingRetentionDays',
    'maxConcurrentLiveSessions',
    'maxConcurrentRecordings',
    'alertIdleThresholdMinutes',
    'alertProductivityThreshold',
    'breakDetectionMinutes'
  ]);

  const booleanKeys = new Set([
    'allowEmployeePortal',
    'requireTwoFactorForAdmins',
    'requireTwoFactorForEmployees',
    'stealthModeDefault',
    'overtimeAlertEnabled'
  ]);

  const stringKeys = new Set([
    'workingHoursStart',
    'workingHoursEnd'
  ]);

  if (numericKeys.has(key)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`${key} must be a non-negative number`);
    }
    return Math.round(numeric);
  }

  if (key === 'companyName') {
    return String(value || DEFAULT_SETTINGS.companyName).trim() || DEFAULT_SETTINGS.companyName;
  }

  if (stringKeys.has(key)) {
    return String(value || '').trim();
  }

  if (booleanKeys.has(key)) {
    return Boolean(value);
  }

  if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return value;
  }

  return value;
}

async function getSettings() {
  const rows = await Setting.findAll();
  const resolved = { ...DEFAULT_SETTINGS };

  rows.forEach((row) => {
    resolved[row.key] = row.value;
  });

  // Storage guardrails: archived screenshots are a lightweight audit trail, not
  // the live-view transport. Keep live screen frames on-demand and prevent
  // frequent screenshot uploads from filling MinIO.
  resolved.screenshotIntervalSeconds = Math.max(Number(resolved.screenshotIntervalSeconds) || 120, 120);
  resolved.screenshotRetentionDays = Math.min(Number(resolved.screenshotRetentionDays) || 7, 7);

  return resolved;
}

async function updateSettings(partial) {
  const updates = {};

  Object.entries(partial).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
      updates[key] = normalizeSettingValue(key, value);
    }
  });

  await Promise.all(
    Object.entries(updates).map(([key, value]) =>
      Setting.upsert({
        key,
        value,
        description: null
      })
    )
  );

  return getSettings();
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings
};
