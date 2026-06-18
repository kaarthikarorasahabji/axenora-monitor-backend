/**
 * BlockedApp model
 * Manages blocked application processes
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const BlockedApp = sequelize.define('BlockedApp', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  processName: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  appName: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'blocked_apps'
});

module.exports = BlockedApp;
