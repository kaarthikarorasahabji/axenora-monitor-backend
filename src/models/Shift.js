/**
 * Shift model
 * Defines work shifts with schedules
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Shift = sequelize.define('Shift', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  startTime: {
    type: DataTypes.TIME,
    allowNull: false
  },
  endTime: {
    type: DataTypes.TIME,
    allowNull: false
  },
  gracePeriodMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 15
  },
  breakMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  workingDays: {
    type: DataTypes.JSONB,
    defaultValue: [1, 2, 3, 4, 5]
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'shifts'
});

module.exports = Shift;
