const { Definition } = require('./definition.js');
const { Api } = require('./api.js');
const config = require('./defaultConfig.json');

module.exports = {
    Definition,
    Config: config,
    Api,
};
