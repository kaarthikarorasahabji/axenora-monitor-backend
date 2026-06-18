'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screenshots', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      machine_id: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      file_path: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'MinIO object key'
      },
      file_size: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'File size in bytes'
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

    await queryInterface.addIndex('screenshots', ['user_id']);
    await queryInterface.addIndex('screenshots', ['timestamp']);
    await queryInterface.addIndex('screenshots', ['user_id', 'timestamp']);
    await queryInterface.addIndex('screenshots', ['machine_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('screenshots');
  }
};
