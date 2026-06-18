'use strict';

const { randomUUID } = require('crypto');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('app_category_rules', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4
      },
      keyword: {
        type: Sequelize.STRING(120),
        allowNull: false
      },
      category: {
        type: Sequelize.ENUM('productive', 'neutral', 'unproductive'),
        allowNull: false,
        defaultValue: 'neutral'
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 100
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('app_category_rules', ['keyword']);
    await queryInterface.addIndex('app_category_rules', ['category']);
    await queryInterface.addIndex('app_category_rules', ['priority']);

    await queryInterface.bulkInsert('app_category_rules', [
      { id: randomUUID(), keyword: 'excel', category: 'productive', priority: 10, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'word', category: 'productive', priority: 10, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'powerpoint', category: 'productive', priority: 10, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'vscode', category: 'productive', priority: 20, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'intellij', category: 'productive', priority: 20, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'github', category: 'productive', priority: 20, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'slack', category: 'neutral', priority: 30, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'teams', category: 'neutral', priority: 30, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'zoom', category: 'neutral', priority: 30, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'youtube', category: 'unproductive', priority: 40, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'facebook', category: 'unproductive', priority: 40, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), keyword: 'instagram', category: 'unproductive', priority: 40, is_active: true, created_at: new Date(), updated_at: new Date() }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('app_category_rules');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_app_category_rules_category";');
  }
};
