const { Op } = require('sequelize');
const { Activity } = require('../models');
const { getSettings } = require('./settings');
const { listCategoryRules, classifyApp } = require('./categoryRules');
const { parseDateBoundary } = require('../utils/dateRange');

const ACTIVITY_INTERVAL_SECONDS = 10;

function initializeDayBucket(dayKey) {
  return {
    date: dayKey,
    firstSeen: null,
    lastSeen: null,
    trackedSeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    productiveSeconds: 0,
    neutralSeconds: 0,
    unproductiveSeconds: 0,
    activityCount: 0
  };
}

async function buildTimesheetSummary(userId, startDate, endDate) {
  const [settings, rules] = await Promise.all([
    getSettings(),
    listCategoryRules()
  ]);

  const idleThreshold = Number(settings.defaultIdleThresholdSeconds || 60);

  const activities = await Activity.findAll({
    where: {
      userId,
      timestamp: {
        [Op.gte]: parseDateBoundary(startDate, 'start'),
        [Op.lte]: parseDateBoundary(endDate, 'end')
      }
    },
    order: [['timestamp', 'ASC']]
  });

  const buckets = {};

  activities.forEach((activity) => {
    const dayKey = activity.timestamp.toISOString().split('T')[0];
    if (!buckets[dayKey]) {
      buckets[dayKey] = initializeDayBucket(dayKey);
    }

    const bucket = buckets[dayKey];
    bucket.activityCount += 1;
    bucket.trackedSeconds += ACTIVITY_INTERVAL_SECONDS;

    if (!bucket.firstSeen || activity.timestamp < bucket.firstSeen) {
      bucket.firstSeen = activity.timestamp;
    }

    if (!bucket.lastSeen || activity.timestamp > bucket.lastSeen) {
      bucket.lastSeen = activity.timestamp;
    }

    if ((activity.idleSeconds || 0) >= idleThreshold) {
      bucket.idleSeconds += ACTIVITY_INTERVAL_SECONDS;
      return;
    }

    bucket.activeSeconds += ACTIVITY_INTERVAL_SECONDS;

    const category = classifyApp(activity.activeApp, rules);
    if (category === 'productive') {
      bucket.productiveSeconds += ACTIVITY_INTERVAL_SECONDS;
    } else if (category === 'unproductive') {
      bucket.unproductiveSeconds += ACTIVITY_INTERVAL_SECONDS;
    } else {
      bucket.neutralSeconds += ACTIVITY_INTERVAL_SECONDS;
    }
  });

  const rows = Object.values(buckets).map((bucket) => ({
    date: bucket.date,
    firstSeen: bucket.firstSeen,
    lastSeen: bucket.lastSeen,
    trackedHours: Number((bucket.trackedSeconds / 3600).toFixed(2)),
    activeHours: Number((bucket.activeSeconds / 3600).toFixed(2)),
    idleHours: Number((bucket.idleSeconds / 3600).toFixed(2)),
    productiveHours: Number((bucket.productiveSeconds / 3600).toFixed(2)),
    neutralHours: Number((bucket.neutralSeconds / 3600).toFixed(2)),
    unproductiveHours: Number((bucket.unproductiveSeconds / 3600).toFixed(2)),
    activityCount: bucket.activityCount
  }));

  const summary = rows.reduce((acc, row) => {
    acc.totalTrackedHours += row.trackedHours;
    acc.totalActiveHours += row.activeHours;
    acc.totalIdleHours += row.idleHours;
    acc.totalProductiveHours += row.productiveHours;
    return acc;
  }, {
    totalTrackedHours: 0,
    totalActiveHours: 0,
    totalIdleHours: 0,
    totalProductiveHours: 0
  });

  return {
    rows,
    summary: {
      totalTrackedHours: Number(summary.totalTrackedHours.toFixed(2)),
      totalActiveHours: Number(summary.totalActiveHours.toFixed(2)),
      totalIdleHours: Number(summary.totalIdleHours.toFixed(2)),
      totalProductiveHours: Number(summary.totalProductiveHours.toFixed(2))
    }
  };
}

module.exports = {
  buildTimesheetSummary
};
