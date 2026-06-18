/**
 * Key-value application settings.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const Setting = sequelize.define('Setting', {
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true
  },
  value: {
    type: DataTypes.JSONB,
    allowNull: false
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'settings'
});

module.exports = Setting;
