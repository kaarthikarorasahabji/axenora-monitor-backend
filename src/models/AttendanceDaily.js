/**
 * AttendanceDaily model
 * Daily attendance summary per employee
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const AttendanceDaily = sequelize.define('AttendanceDaily', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  employeeId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  firstClockIn: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastClockOut: {
    type: DataTypes.DATE,
    allowNull: true
  },
  totalHours: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  breakMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  sessionCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekly_off'),
    defaultValue: 'present'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'attendance_daily',
  indexes: [
    { fields: ['employee_id', 'date'], unique: true },
    { fields: ['employee_id'] },
    { fields: ['date'] },
    { fields: ['status'] }
  ]
});

module.exports = AttendanceDaily;
