/**
 * Shared Sequelize instance.
 * Keeping this separate avoids circular model imports.
 */

const { Sequelize } = require('sequelize');

const DB_SCHEMA = process.env.DB_SCHEMA || 'monitor';

const dbUrl = (process.env.DATABASE_URL || '')
  .replace('sslmode=require', 'sslmode=require&uselibpqcompat=true');

const sequelize = new Sequelize(dbUrl, {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: {
    ssl: dbUrl.includes('sslmode=')
      ? { require: true, rejectUnauthorized: false }
      : false,
  },
  schema: DB_SCHEMA,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    timestamps: true,
    underscored: true,
    schema: DB_SCHEMA,
  }
});

module.exports = { sequelize };
