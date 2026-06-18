/**
 * API tokens for integrations and external API access.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const ApiToken = sequelize.define('ApiToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  label: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  tokenHash: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  scopes: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: ['read:analytics']
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  lastUsedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  createdByUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'api_tokens',
  indexes: [
    { fields: ['created_by_user_id'] },
    { fields: ['is_active'] }
  ]
});

module.exports = ApiToken;
