const { applyRetentionPolicies } = require('./retention');
const { logAuditEvent } = require('./audit');

let timerHandle = null;

async function runRetentionCycle(source = 'startup') {
  try {
    const result = await applyRetentionPolicies();
    console.log(`[retention] ${source} cleanup complete`, result);

    await logAuditEvent({
      action: 'retention-run',
      resourceType: 'retention',
      method: 'SYSTEM',
      path: `scheduler:${source}`,
      statusCode: 200,
      metadata: result
    });
  } catch (error) {
    console.error(`[retention] ${source} cleanup failed`, error);
  }
}

function startRetentionScheduler() {
  if (timerHandle) {
    return;
  }

  runRetentionCycle('startup');

  timerHandle = setInterval(() => {
    runRetentionCycle('scheduled');
  }, 24 * 60 * 60 * 1000);

  if (typeof timerHandle.unref === 'function') {
    timerHandle.unref();
  }
}

function stopRetentionScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

module.exports = {
  startRetentionScheduler,
  stopRetentionScheduler
};
