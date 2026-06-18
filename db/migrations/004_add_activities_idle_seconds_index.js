'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addIndex('activities', ['idle_seconds'], {
      name: 'activities_idle_seconds'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('activities', 'activities_idle_seconds');
  }
};
