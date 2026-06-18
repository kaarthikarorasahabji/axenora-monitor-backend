'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'two_factor_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn('users', 'two_factor_secret', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addIndex('users', ['two_factor_enabled']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', ['two_factor_enabled']);
    await queryInterface.removeColumn('users', 'two_factor_secret');
    await queryInterface.removeColumn('users', 'two_factor_enabled');
  }
};
