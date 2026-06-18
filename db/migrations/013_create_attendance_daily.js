'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_daily', {
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
      first_clock_in: {
        type: Sequelize.DATE,
        allowNull: true
      },
      last_clock_out: {
        type: Sequelize.DATE,
        allowNull: true
      },
      total_hours: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 0
      },
      break_minutes: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      session_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      status: {
        type: Sequelize.ENUM('present', 'absent', 'half_day', 'late', 'on_leave'),
        defaultValue: 'present'
      },
      notes: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('attendance_daily', ['employee_id', 'date'], { unique: true });
    await queryInterface.addIndex('attendance_daily', ['employee_id']);
    await queryInterface.addIndex('attendance_daily', ['date']);
    await queryInterface.addIndex('attendance_daily', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('attendance_daily');
  }
};
