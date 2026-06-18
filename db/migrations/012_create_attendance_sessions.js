'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_sessions', {
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
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      clock_in: {
        type: Sequelize.DATE,
        allowNull: false
      },
      clock_out: {
        type: Sequelize.DATE,
        allowNull: true
      },
      source: {
        type: Sequelize.ENUM('agent_auto', 'manual', 'system_timeout'),
        defaultValue: 'agent_auto'
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

    await queryInterface.addIndex('attendance_sessions', ['employee_id']);
    await queryInterface.addIndex('attendance_sessions', ['date']);
    await queryInterface.addIndex('attendance_sessions', ['employee_id', 'date']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('attendance_sessions');
  }
};
