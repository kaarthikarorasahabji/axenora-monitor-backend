'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('activities', 'intensity_score', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });
    await queryInterface.addColumn('activities', 'keystrokes', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });
    await queryInterface.addColumn('activities', 'mouse_clicks', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });
    await queryInterface.addColumn('activities', 'mouse_distance', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('activities', 'intensity_score');
    await queryInterface.removeColumn('activities', 'keystrokes');
    await queryInterface.removeColumn('activities', 'mouse_clicks');
    await queryInterface.removeColumn('activities', 'mouse_distance');
  }
};
