/**
 * Attendance service
 * Manages clock-in/out sessions and daily consolidation
 */

const { Op } = require('sequelize');
const { AttendanceSession, AttendanceDaily, User, Holiday, LeaveRequest, EmployeeShift, Shift } = require('../models');
const { enqueueWebhook } = require('./webhookQueue');

// CRM webhook URL for auto-attendance sync
const CRM_WEBHOOK_URL = process.env.CRM_ATTENDANCE_WEBHOOK_URL || '';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || 'thainaturals-monitor-webhook-2026';

function parseEventTimestamp(timestamp) {
  const ts = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(ts.getTime()) ? new Date() : ts;
}

/**
 * Forward clock event to CRM backend.
 *
 * Persists the delivery to the `webhook_deliveries` outbox; the retry
 * worker (startWebhookWorker) drains it with exponential backoff. The
 * caller never blocks on network — only on the User lookup and one
 * small DB insert.
 *
 * `monitor_event_id` is the stable idempotency key the CRM uses to
 * deduplicate repeat deliveries. `event_at` preserves the original
 * timestamp for offline-cached events. `source` distinguishes normal
 * events from auto-close events.
 */
async function forwardToCRM(employeeId, eventType, machineId, opts = {}) {
  if (!CRM_WEBHOOK_URL) return;

  try {
    const user = await User.findByPk(employeeId, { attributes: ['email'] });
    if (!user?.email) return;

    const eventAt = opts.eventAt ? new Date(opts.eventAt) : new Date();
    const monitorEventId = opts.monitorEventId
      ? String(opts.monitorEventId)
      : `${employeeId}:${eventType}:${eventAt.getTime()}`;
    const source = opts.source || 'monitor';

    await enqueueWebhook({
      target: 'crm_attendance',
      url: CRM_WEBHOOK_URL,
      method: 'POST',
      headers: { 'X-Webhook-Secret': CRM_WEBHOOK_SECRET },
      payload: {
        email: user.email,
        event_type: eventType,
        machine_id: machineId,
        monitor_event_id: monitorEventId,
        event_at: eventAt.toISOString(),
        source,
      },
    });
  } catch (err) {
    console.warn(`CRM webhook enqueue failed (non-blocking): ${err.message}`);
  }
}

/**
 * Clock in an employee — creates a new attendance session
 */
async function clockIn(employeeId, machineId, timestamp) {
  const ts = parseEventTimestamp(timestamp);
  const dateStr = ts.toISOString().slice(0, 10);

  // Check for an already-open session today
  const existing = await AttendanceSession.findOne({
    where: {
      employeeId,
      date: dateStr,
      clockOut: null
    }
  });

  if (existing) {
    await getOrCreateDaily(employeeId, dateStr, existing.clockIn || ts);
    return existing; // Already clocked in
  }

  const session = await AttendanceSession.create({
    employeeId,
    date: dateStr,
    clockIn: ts,
    source: 'agent',
    machineId
  });

  // Ensure a daily record exists
  await getOrCreateDaily(employeeId, dateStr, ts);

  // Forward to CRM (fire-and-forget)
  forwardToCRM(employeeId, 'clock-in', machineId, {
    eventAt: ts,
    monitorEventId: `session:${session.id}:in`,
    source: 'monitor',
  }).catch(() => {});

  return session;
}

/**
 * Clock out an employee — closes the most recent open session
 */
async function clockOut(employeeId, machineId, timestamp) {
  const ts = parseEventTimestamp(timestamp);
  const dateStr = ts.toISOString().slice(0, 10);

  const session = await AttendanceSession.findOne({
    where: {
      employeeId,
      date: dateStr,
      clockOut: null
    },
    order: [['clockIn', 'DESC']]
  });

  if (!session) return null;

  session.clockOut = ts;

  // Calculate duration in hours
  const durationMs = ts.getTime() - new Date(session.clockIn).getTime();
  session.durationMinutes = Math.round(durationMs / 60000);
  await session.save();

  // Consolidate daily record
  await consolidateDaily(employeeId, dateStr);

  // Forward to CRM (fire-and-forget)
  forwardToCRM(employeeId, 'clock-out', machineId, {
    eventAt: ts,
    monitorEventId: `session:${session.id}:out`,
    source: 'monitor',
  }).catch(() => {});

  return session;
}

/**
 * Get or create an AttendanceDaily record
 */
async function getOrCreateDaily(employeeId, dateStr, firstClockIn = new Date()) {
  const [daily, created] = await AttendanceDaily.findOrCreate({
    where: { employeeId, date: dateStr },
    defaults: {
      employeeId,
      date: dateStr,
      status: 'present',
      totalHours: 0,
      firstClockIn,
      sessionCount: 1
    }
  });
  if (!created && daily.status === 'absent') {
    daily.status = 'present';
    daily.firstClockIn = daily.firstClockIn || firstClockIn;
    daily.sessionCount = Math.max(daily.sessionCount || 0, 1);
    await daily.save();
  }
  return daily;
}

/**
 * Resolve the effective shift for an employee on a given date.
 * Falls back to a sensible default if no shift is assigned.
 */
async function getEffectiveShift(employeeId, dateStr) {
  const empShift = await EmployeeShift.findOne({
    where: {
      employeeId,
      effectiveFrom: { [Op.lte]: dateStr },
      [Op.or]: [
        { effectiveTo: null },
        { effectiveTo: { [Op.gte]: dateStr } }
      ]
    },
    include: [{ model: Shift, as: 'shift' }],
    order: [['effectiveFrom', 'DESC']]
  });
  if (empShift && empShift.shift) return empShift.shift;
  // Fallback: first active shift (company default).
  return Shift.findOne({ where: { isActive: true }, order: [['createdAt', 'ASC']] });
}

/**
 * Consolidate all sessions for a given employee + date into the daily record.
 *
 * Checks holidays, approved leaves, weekly working-day calendars, shift
 * grace periods, and subtracts configured break minutes from total hours.
 */
async function consolidateDaily(employeeId, dateStr) {
  const daily = await getOrCreateDaily(employeeId, dateStr);
  const jsDate = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = jsDate.getUTCDay(); // 0=Sun … 6=Sat

  // ── Holiday check ─────────────────────────────────────────────────
  const holiday = await Holiday.findOne({
    where: { date: dateStr, isActive: true }
  });
  if (holiday) {
    daily.status = 'holiday';
    daily.notes = holiday.name;
    await daily.save();
    return;
  }

  // ── Approved leave check ──────────────────────────────────────────
  const leave = await LeaveRequest.findOne({
    where: {
      employeeId,
      status: 'approved',
      fromDate: { [Op.lte]: dateStr },
      toDate: { [Op.gte]: dateStr }
    }
  });
  if (leave) {
    daily.status = 'on_leave';
    daily.notes = `${leave.leaveType} leave`;
    await daily.save();
    return;
  }

  // ── Shift + weekly off check ──────────────────────────────────────
  const shift = await getEffectiveShift(employeeId, dateStr);
  const workingDays = shift ? (shift.workingDays || [1, 2, 3, 4, 5]) : [1, 2, 3, 4, 5];
  if (!workingDays.includes(dayOfWeek)) {
    daily.status = 'weekly_off';
    await daily.save();
    return;
  }

  // ── Session aggregation ───────────────────────────────────────────
  const sessions = await AttendanceSession.findAll({
    where: { employeeId, date: dateStr },
    order: [['clockIn', 'ASC']]
  });

  if (sessions.length === 0) {
    daily.status = 'absent';
    daily.totalHours = 0;
    daily.sessionCount = 0;
    await daily.save();
    return;
  }

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const firstClockIn = sessions[0].clockIn;
  const lastSession = sessions[sessions.length - 1];
  const lastClockOut = lastSession.clockOut || null;

  // Subtract configured break minutes from total work time.
  const breakMins = shift ? (shift.breakMinutes || 0) : 0;
  const effectiveMinutes = Math.max(totalMinutes - breakMins, 0);

  // Shift-proportional thresholds instead of hardcoded 240 min.
  const shiftDurationMinutes = shift
    ? (() => {
        const [sh, sm] = (shift.startTime || '09:30').split(':').map(Number);
        const [eh, em] = (shift.endTime || '18:30').split(':').map(Number);
        return (eh * 60 + em) - (sh * 60 + sm);
      })()
    : 540; // default 9h
  const fullDayThreshold = shiftDurationMinutes * 0.8;   // ≥80% → present
  const halfDayThreshold = shiftDurationMinutes * 0.5;   // ≥50% → half_day

  // Grace period: late if first clock-in is after shift start + grace.
  const graceMins = shift ? (shift.gracePeriodMinutes || 15) : 15;
  let isLate = false;
  if (shift && firstClockIn) {
    const [startH, startM] = (shift.startTime || '09:30').split(':').map(Number);
    const clockInDate = new Date(firstClockIn);
    const clockInMinutes = clockInDate.getUTCHours() * 60 + clockInDate.getUTCMinutes();
    const shiftStartMinutes = startH * 60 + startM;
    if (clockInMinutes > shiftStartMinutes + graceMins) {
      isLate = true;
    }
  }

  let status;
  if (effectiveMinutes >= fullDayThreshold) {
    status = isLate ? 'late' : 'present';
  } else if (effectiveMinutes >= halfDayThreshold) {
    status = 'half_day';
  } else if (effectiveMinutes > 0) {
    status = 'half_day';
  } else {
    status = 'absent';
  }

  daily.totalHours = Math.round((effectiveMinutes / 60) * 100) / 100;
  daily.firstClockIn = firstClockIn;
  daily.lastClockOut = lastClockOut;
  daily.sessionCount = sessions.length;
  daily.breakMinutes = breakMins;
  daily.status = status;

  await daily.save();
}

/**
 * Get attendance records with pagination and filters
 */
async function getAttendanceRecords({ startDate, endDate, employeeId, status, page = 1, limit = 20 }) {
  const where = {};

  if (startDate && endDate) {
    where.date = { [Op.between]: [startDate, endDate] };
  } else if (startDate) {
    where.date = { [Op.gte]: startDate };
  } else if (endDate) {
    where.date = { [Op.lte]: endDate };
  }

  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;

  const offset = (page - 1) * limit;

  const { count, rows } = await AttendanceDaily.findAndCountAll({
    where,
    include: [{
      model: User,
      as: 'employee',
      attributes: ['id', 'name', 'email', 'department', 'machineId']
    }],
    limit,
    offset,
    order: [['date', 'DESC']]
  });

  return {
    records: rows,
    total: count,
    page,
    totalPages: Math.max(Math.ceil(count / limit), 1)
  };
}

/**
 * Get attendance summary for an employee for a given month (YYYY-MM)
 */
async function getAttendanceSummary(employeeId, month) {
  const startDate = `${month}-01`;
  const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
    .toISOString().slice(0, 10);

  const records = await AttendanceDaily.findAll({
    where: {
      employeeId,
      date: { [Op.between]: [startDate, endDate] }
    }
  });

  const totalDays = records.length;
  const presentDays = records.filter(r => r.status === 'present').length;
  const absentDays = records.filter(r => r.status === 'absent').length;
  const halfDays = records.filter(r => r.status === 'half_day').length;
  const lateDays = records.filter(r => r.status === 'late').length;
  const totalHours = records.reduce((sum, r) => sum + (parseFloat(r.totalHours) || 0), 0);
  const avgHours = totalDays > 0 ? Math.round((totalHours / totalDays) * 100) / 100 : 0;

  return {
    month,
    employeeId,
    totalDays,
    presentDays,
    absentDays,
    halfDays,
    lateDays,
    totalHours: Math.round(totalHours * 100) / 100,
    avgHours
  };
}

module.exports = {
  clockIn,
  clockOut,
  consolidateDaily,
  forwardToCRM,
  getAttendanceRecords,
  getAttendanceSummary
};
