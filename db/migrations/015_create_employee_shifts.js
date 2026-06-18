'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('employee_shifts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      employee_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      shift_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'shifts',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      effective_from: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      effective_to: {
        type: Sequelize.DATEONLY,
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

    await queryInterface.addIndex('employee_shifts', ['employee_id']);
    await queryInterface.addIndex('employee_shifts', ['shift_id']);
    await queryInterface.addIndex('employee_shifts', ['employee_id', 'shift_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('employee_shifts');
  }
};
