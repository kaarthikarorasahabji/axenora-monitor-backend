'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'department_id', {
      type: Sequelize.UUID,
      allowNull: true
    });
    await queryInterface.addColumn('users', 'team_id', {
      type: Sequelize.UUID,
      allowNull: true
    });
    await queryInterface.addColumn('users', 'hourly_rate', {
      type: Sequelize.DECIMAL(8, 2),
      allowNull: true
    });
    await queryInterface.addColumn('users', 'job_title', {
      type: Sequelize.STRING(100),
      allowNull: true
    });
    await queryInterface.addColumn('users', 'is_field_staff', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'department_id');
    await queryInterface.removeColumn('users', 'team_id');
    await queryInterface.removeColumn('users', 'hourly_rate');
    await queryInterface.removeColumn('users', 'job_title');
    await queryInterface.removeColumn('users', 'is_field_staff');
  }
};
