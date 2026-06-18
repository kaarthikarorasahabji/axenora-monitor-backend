const { Op } = require('sequelize');
const { Activity, Screenshot, AuditLog } = require('../models');
const { deleteFiles } = require('./storage');
const { getSettings } = require('./settings');

function buildCutoff(days) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(days));
  return cutoff;
}

async function applyRetentionPolicies(overrides = null) {
  const settings = overrides || await getSettings();

  const activityCutoff = buildCutoff(settings.activityRetentionDays);
  const screenshotCutoff = buildCutoff(settings.screenshotRetentionDays);
  const auditCutoff = buildCutoff(settings.auditRetentionDays);

  const screenshotsToDelete = await Screenshot.findAll({
    where: {
      timestamp: { [Op.lt]: screenshotCutoff }
    },
    attributes: ['id', 'filePath']
  });

  const filePaths = screenshotsToDelete.map((row) => row.filePath).filter(Boolean);
  if (filePaths.length > 0) {
    try {
      await deleteFiles(filePaths);
    } catch (error) {
      console.error('Failed to delete screenshot files during retention cleanup:', error);
    }
  }

  const [activityDeleted, screenshotDeleted, auditDeleted] = await Promise.all([
    Activity.destroy({ where: { timestamp: { [Op.lt]: activityCutoff } } }),
    Screenshot.destroy({ where: { timestamp: { [Op.lt]: screenshotCutoff } } }),
    AuditLog.destroy({ where: { createdAt: { [Op.lt]: auditCutoff } } })
  ]);

  return {
    activityDeleted,
    screenshotDeleted,
    auditDeleted
  };
}

module.exports = {
  applyRetentionPolicies
};
