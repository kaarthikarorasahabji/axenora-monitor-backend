const { Op } = require('sequelize');
const { Activity } = require('../models');
const { getSettings } = require('./settings');
const { listCategoryRules, classifyApp } = require('./categoryRules');
const { parseDateBoundary } = require('../utils/dateRange');

const INTERVAL_SECONDS = 10;

function getDayKey(value) {
  return new Date(value).toISOString().split('T')[0];
}

function buildLinearForecast(points, horizon = 7) {
  if (points.length === 0) {
    return Array.from({ length: horizon }, (_, index) => ({
      offset: index + 1,
      expectedTrackedHours: 0,
      expectedProductiveHours: 0
    }));
  }

  const n = points.length;
  const sumX = points.reduce((sum, _, index) => sum + index, 0);
  const sumTrackedY = points.reduce((sum, point) => sum + point.trackedHours, 0);
  const sumProductiveY = points.reduce((sum, point) => sum + point.productiveHours, 0);
  const sumX2 = points.reduce((sum, _, index) => sum + index * index, 0);
  const sumTrackedXY = points.reduce((sum, point, index) => sum + index * point.trackedHours, 0);
  const sumProductiveXY = points.reduce((sum, point, index) => sum + index * point.productiveHours, 0);
  const denominator = (n * sumX2) - (sumX * sumX) || 1;

  const trackedSlope = ((n * sumTrackedXY) - (sumX * sumTrackedY)) / denominator;
  const trackedIntercept = (sumTrackedY - (trackedSlope * sumX)) / n;
  const productiveSlope = ((n * sumProductiveXY) - (sumX * sumProductiveY)) / denominator;
  const productiveIntercept = (sumProductiveY - (productiveSlope * sumX)) / n;

  return Array.from({ length: horizon }, (_, index) => {
    const x = points.length + index;
    return {
      offset: index + 1,
      expectedTrackedHours: Number(Math.max(trackedIntercept + (trackedSlope * x), 0).toFixed(2)),
      expectedProductiveHours: Number(Math.max(productiveIntercept + (productiveSlope * x), 0).toFixed(2))
    };
  });
}

async function buildAdvancedAnalytics(userId, startDate, endDate) {
  const [settings, rules, activities] = await Promise.all([
    getSettings(),
    listCategoryRules(),
    Activity.findAll({
      where: {
        userId,
        timestamp: {
          [Op.gte]: parseDateBoundary(startDate, 'start'),
          [Op.lte]: parseDateBoundary(endDate, 'end')
        }
      },
      order: [['timestamp', 'ASC']]
    })
  ]);

  const idleThreshold = Number(settings.defaultIdleThresholdSeconds || 60);
  let contextSwitchCount = 0;
  let previousApp = null;
  let currentFocusSeconds = 0;
  let longestFocusSeconds = 0;
  let focusBlocks = 0;
  const hourlyContextSwitches = {};
  const anomalyFlags = [];
  const dailyBuckets = {};

  activities.forEach((activity, index) => {
    const timestamp = new Date(activity.timestamp);
    const dayKey = getDayKey(timestamp);
    const hour = timestamp.getHours();
    const category = (activity.idleSeconds || 0) >= idleThreshold
      ? 'idle'
      : classifyApp(activity.activeApp, rules);

    if (!dailyBuckets[dayKey]) {
      dailyBuckets[dayKey] = {
        date: dayKey,
        trackedSeconds: 0,
        productiveSeconds: 0,
        idleSeconds: 0,
        contextSwitches: 0,
        afterHoursEvents: 0
      };
    }

    dailyBuckets[dayKey].trackedSeconds += INTERVAL_SECONDS;

    if (hour < 7 || hour > 20) {
      dailyBuckets[dayKey].afterHoursEvents += 1;
    }

    if (category === 'productive') {
      currentFocusSeconds += INTERVAL_SECONDS;
      dailyBuckets[dayKey].productiveSeconds += INTERVAL_SECONDS;
    } else {
      if (currentFocusSeconds >= 30 * 60) {
        focusBlocks += 1;
      }
      longestFocusSeconds = Math.max(longestFocusSeconds, currentFocusSeconds);
      currentFocusSeconds = 0;
    }

    if (category === 'idle') {
      dailyBuckets[dayKey].idleSeconds += INTERVAL_SECONDS;
    }

    if (previousApp && activity.activeApp && previousApp !== activity.activeApp) {
      contextSwitchCount += 1;
      dailyBuckets[dayKey].contextSwitches += 1;
      hourlyContextSwitches[hour] = (hourlyContextSwitches[hour] || 0) + 1;
    }

    previousApp = activity.activeApp || previousApp;

    if (index === activities.length - 1 && currentFocusSeconds >= 30 * 60) {
      focusBlocks += 1;
      longestFocusSeconds = Math.max(longestFocusSeconds, currentFocusSeconds);
    }
  });

  const dailyRows = Object.values(dailyBuckets).map((bucket) => ({
    ...bucket,
    trackedHours: Number((bucket.trackedSeconds / 3600).toFixed(2)),
    productiveHours: Number((bucket.productiveSeconds / 3600).toFixed(2)),
    idleHours: Number((bucket.idleSeconds / 3600).toFixed(2))
  }));

  dailyRows.forEach((bucket) => {
    const idlePct = bucket.trackedSeconds > 0
      ? (bucket.idleSeconds / bucket.trackedSeconds) * 100
      : 0;

    if (idlePct >= 40) {
      anomalyFlags.push({
        type: 'idle-spike',
        severity: 'medium',
        date: bucket.date,
        message: `Idle time reached ${idlePct.toFixed(0)}% on ${bucket.date}`
      });
    }

    if (bucket.contextSwitches >= 30) {
      anomalyFlags.push({
        type: 'context-switch-overload',
        severity: 'medium',
        date: bucket.date,
        message: `${bucket.contextSwitches} context switches detected on ${bucket.date}`
      });
    }

    if (bucket.afterHoursEvents >= 30) {
      anomalyFlags.push({
        type: 'after-hours-activity',
        severity: 'low',
        date: bucket.date,
        message: `Sustained after-hours activity detected on ${bucket.date}`
      });
    }
  });

  const forecast = buildLinearForecast(dailyRows);

  return {
    summary: {
      contextSwitchCount,
      averageContextSwitchesPerHour: Number((contextSwitchCount / Math.max(Object.keys(hourlyContextSwitches).length, 1)).toFixed(2)),
      focusBlocks,
      longestFocusHours: Number((longestFocusSeconds / 3600).toFixed(2)),
      anomalyCount: anomalyFlags.length
    },
    daily: dailyRows,
    hourlyContextSwitches: Object.entries(hourlyContextSwitches).map(([hour, count]) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      count
    })),
    anomalies: anomalyFlags,
    forecast
  };
}

module.exports = {
  buildAdvancedAnalytics
};
