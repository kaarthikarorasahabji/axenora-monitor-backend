/**
 * AttendanceSession model
 * Tracks individual clock-in/clock-out sessions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const AttendanceSession = sequelize.define('AttendanceSession', {
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
  clockIn: {
    type: DataTypes.DATE,
    allowNull: false
  },
  clockOut: {
    type: DataTypes.DATE,
    allowNull: true
  },
  machineId: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  durationMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  source: {
    type: DataTypes.ENUM('agent_auto', 'manual', 'system_timeout', 'agent'),
    defaultValue: 'agent_auto'
  }
}, {
  tableName: 'attendance_sessions',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['date'] },
    { fields: ['employee_id', 'date'] }
  ]
});

module.exports = AttendanceSession;
