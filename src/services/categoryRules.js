const { AppCategoryRule } = require('../models');

const DEFAULT_CATEGORY_RULES = [
  { keyword: 'excel', category: 'productive', priority: 10, isActive: true },
  { keyword: 'word', category: 'productive', priority: 10, isActive: true },
  { keyword: 'powerpoint', category: 'productive', priority: 10, isActive: true },
  { keyword: 'vscode', category: 'productive', priority: 20, isActive: true },
  { keyword: 'intellij', category: 'productive', priority: 20, isActive: true },
  { keyword: 'github', category: 'productive', priority: 20, isActive: true },
  { keyword: 'slack', category: 'neutral', priority: 30, isActive: true },
  { keyword: 'teams', category: 'neutral', priority: 30, isActive: true },
  { keyword: 'zoom', category: 'neutral', priority: 30, isActive: true },
  { keyword: 'youtube', category: 'unproductive', priority: 40, isActive: true },
  { keyword: 'facebook', category: 'unproductive', priority: 40, isActive: true },
  { keyword: 'instagram', category: 'unproductive', priority: 40, isActive: true }
];

async function listCategoryRules() {
  const rules = await AppCategoryRule.findAll({
    where: { isActive: true },
    order: [['priority', 'ASC'], ['keyword', 'ASC']]
  });

  if (rules.length > 0) {
    return rules;
  }

  return DEFAULT_CATEGORY_RULES;
}

function classifyApp(appName, rules = DEFAULT_CATEGORY_RULES) {
  if (!appName) {
    return 'neutral';
  }

  const lowerApp = String(appName).toLowerCase();

  for (const rule of rules) {
    const keyword = String(rule.keyword || '').trim().toLowerCase();
    if (keyword && lowerApp.includes(keyword)) {
      return rule.category;
    }
  }

  return 'neutral';
}

module.exports = {
  DEFAULT_CATEGORY_RULES,
  listCategoryRules,
  classifyApp
};
