/**
 * BlockedSite model
 * Manages blocked website URL patterns
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const BlockedSite = sequelize.define('BlockedSite', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  urlPattern: {
    type: DataTypes.STRING(500),
    allowNull: false
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
  tableName: 'blocked_websites'
});

module.exports = BlockedSite;
