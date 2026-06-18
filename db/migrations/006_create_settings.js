'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('settings', {
      key: {
        type: Sequelize.STRING(100),
        primaryKey: true,
        allowNull: false
      },
      value: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true
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

    await queryInterface.bulkInsert('settings', [
      {
        key: 'companyName',
        value: 'Employee Monitor',
        description: 'Product display name',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'allowEmployeePortal',
        value: true,
        description: 'Allow employees to log into the self-service portal',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'requireTwoFactorForAdmins',
        value: false,
        description: 'Require TOTP for admin users',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'requireTwoFactorForEmployees',
        value: false,
        description: 'Require TOTP for employee users',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'activityRetentionDays',
        value: 90,
        description: 'How long to keep activity records',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'screenshotRetentionDays',
        value: 30,
        description: 'How long to keep screenshots',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'auditRetentionDays',
        value: 180,
        description: 'How long to keep audit logs',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        key: 'defaultIdleThresholdSeconds',
        value: 60,
        description: 'Default idle threshold in seconds',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('settings');
  }
};
