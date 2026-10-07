const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'round-config.json');

const DEFAULT_CONFIG = {
  radius: 12,
  outputPath: '',
  suffix: '_rounded',
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULT_CONFIG, ...config }, null, 2), 'utf8');
  } catch {}
}

module.exports = { CONFIG_PATH, DEFAULT_CONFIG, loadConfig, saveConfig };
