#!/usr/bin/env node
/**
 * One-time cleanup script: removes all test employees and their data.
 * Keeps only admin user(s). Run from backend directory:
 *   node scripts/cleanup-test-data.js
 */

require('dotenv').config();
const { sequelize } = require('../src/models/sequelize');
const User = require('../src/models/User');
const Activity = require('../src/models/Activity');
const Screenshot = require('../src/models/Screenshot');
const Recording = require('../src/models/Recording');
const Alert = require('../src/models/Alert');
const AttendanceSession = require('../src/models/AttendanceSession');
const AttendanceDaily = require('../src/models/AttendanceDaily');
const EmployeeShift = require('../src/models/EmployeeShift');
const AuditLog = require('../src/models/AuditLog');
const ApiToken = require('../src/models/ApiToken');

async function cleanup() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database.\n');

    // Find all employee (non-admin) users
    const employees = await User.findAll({ where: { role: 'employee' } });
    const employeeIds = employees.map(e => e.id);

    console.log(`Found ${employees.length} employee(s) to remove:`);
    employees.forEach(e => console.log(`  - ${e.name} (${e.email})`));

    if (employeeIds.length === 0) {
      console.log('\nNo test employees to clean up.');
      await sequelize.close();
      return;
    }

    // Delete related data in correct order (foreign keys)
    const tables = [
      { model: Screenshot, name: 'Screenshots' },
      { model: Recording, name: 'Recordings' },
      { model: Activity, name: 'Activities' },
      { model: Alert, name: 'Alerts' },
      { model: AttendanceSession, name: 'AttendanceSessions' },
      { model: AttendanceDaily, name: 'AttendanceDaily' },
      { model: EmployeeShift, name: 'EmployeeShifts' },
      { model: ApiToken, name: 'ApiTokens' },
      { model: AuditLog, name: 'AuditLogs' },
    ];

    for (const { model, name } of tables) {
      try {
        const count = await model.destroy({ where: { employeeId: employeeIds } });
        console.log(`  Deleted ${count} ${name}`);
      } catch (err) {
        // Some tables may use userId instead of employeeId
        try {
          const count = await model.destroy({ where: { userId: employeeIds } });
          console.log(`  Deleted ${count} ${name}`);
        } catch (err2) {
          console.log(`  Skipped ${name} (no matching FK column)`);
        }
      }
    }

    // Delete the employees themselves
    const deleted = await User.destroy({ where: { role: 'employee' } });
    console.log(`\nDeleted ${deleted} employee user(s).`);

    // Show remaining admin users
    const admins = await User.findAll({ where: { role: 'admin' } });
    console.log(`\nRemaining admin user(s):`);
    admins.forEach(a => console.log(`  - ${a.name} (${a.email})`));

    console.log('\nCleanup complete.');
    await sequelize.close();
  } catch (error) {
    console.error('Cleanup failed:', error.message);
    process.exit(1);
  }
}

cleanup();
