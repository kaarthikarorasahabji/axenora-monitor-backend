/**
 * Auto-checkout scheduler.
 *
 * Runs once an hour. For any employee with an open AttendanceSession
 * (clockOut IS NULL) where shift end + 1 hour has passed, inserts a
 * synthetic clock-out at shift end time with source='auto_close' and
 * flags the daily record for manager review.
 */

const { Op } = require('sequelize');
const { AttendanceSession, AttendanceDaily, User, EmployeeShift, Shift } = require('../models');
const { consolidateDaily, forwardToCRM } = require('./attendance');

const AUTO_CHECKOUT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let intervalHandle = null;

/**
 * Resolve shift end time as a Date for today (UTC).
 */
function shiftEndToday(shift) {
  const [h, m] = (shift.endTime || '18:30').split(':').map(Number);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
}

async function runAutoCheckout() {
  try {
    const openSessions = await AttendanceSession.findAll({
      where: { clockOut: null },
      include: [{ model: User, as: 'employee', attributes: ['id', 'email'] }]
    });

    if (openSessions.length === 0) return;

    const now = new Date();
    let closedCount = 0;

    for (const session of openSessions) {
      // Resolve employee's shift.
      const empShift = await EmployeeShift.findOne({
        where: {
          employeeId: session.employeeId,
          effectiveFrom: { [Op.lte]: session.date },
          [Op.or]: [
            { effectiveTo: null },
            { effectiveTo: { [Op.gte]: session.date } }
          ]
        },
        include: [{ model: Shift, as: 'shift' }],
        order: [['effectiveFrom', 'DESC']]
      });

      const shift = empShift?.shift || await Shift.findOne({ where: { isActive: true } });
      if (!shift) continue;

      const endTime = shiftEndToday(shift);
      const graceMs = 60 * 60 * 1000; // 1 hour past shift end
      if (now < new Date(endTime.getTime() + graceMs)) continue;

      // Auto-close at shift end.
      session.clockOut = endTime;
      const clockInMs = new Date(session.clockIn).getTime();
      session.durationMinutes = Math.max(
        Math.round((endTime.getTime() - clockInMs) / 60000),
        0
      );
      session.source = 'auto_close';
      await session.save();

      // Re-consolidate the daily record and flag for review.
      await consolidateDaily(session.employeeId, session.date);

      const daily = await AttendanceDaily.findOne({
        where: { employeeId: session.employeeId, date: session.date }
      });
      if (daily) {
        daily.notes = (daily.notes ? daily.notes + '; ' : '') +
          'Auto-closed — verify with employee';
        await daily.save();
      }

      // Mirror the auto-close event to the CRM so the two systems stay in sync.
      if (typeof forwardToCRM === 'function') {
        forwardToCRM(session.employeeId, 'clock-out', session.machineId || null, {
          eventAt: endTime,
          monitorEventId: `session:${session.id}:auto_close`,
          source: 'auto_close',
        }).catch(() => {});
      }

      console.log(`[auto-checkout] Closed session for ${session.employee?.email || session.employeeId} on ${session.date}`);
      closedCount++;
    }

    if (closedCount > 0) {
      console.log(`[auto-checkout] Closed ${closedCount} open sessions`);
    }
  } catch (err) {
    console.error('[auto-checkout] Error:', err);
  }
}

function startAutoCheckoutScheduler() {
  if (intervalHandle) return;
  intervalHandle = setInterval(runAutoCheckout, AUTO_CHECKOUT_INTERVAL_MS);
  // Also run once on startup to catch overnight stragglers.
  runAutoCheckout();
  console.log('Auto-checkout scheduler started (every 1 hour)');
}

function stopAutoCheckoutScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startAutoCheckoutScheduler, stopAutoCheckoutScheduler, runAutoCheckout };
