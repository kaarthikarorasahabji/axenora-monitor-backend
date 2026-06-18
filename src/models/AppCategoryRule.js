/**
 * Configurable app categorization rules.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('./sequelize');

const AppCategoryRule = sequelize.define('AppCategoryRule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  keyword: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM('productive', 'neutral', 'unproductive'),
    allowNull: false,
    defaultValue: 'neutral'
  },
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'app_category_rules',
  indexes: [
    { fields: ['keyword'] },
    { fields: ['category'] },
    { fields: ['priority'] }
  ]
});

module.exports = AppCategoryRule;
