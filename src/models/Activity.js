/**
 * Activity model
 * Tracks employee activity data
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Activity = sequelize.define('Activity', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  machineId: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  activeApp: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  windowTitle: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  idleSeconds: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'activities',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['timestamp'] },
    { fields: ['user_id', 'timestamp'] },
    { fields: ['machine_id'] },
    { fields: ['idle_seconds'] }
  ]
});

module.exports = Activity;
