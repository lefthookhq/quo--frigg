const { Definition } = require('./definition.js');

const { Api } = require('./api.js');
const Config = require('./defaultConfig.json');
module.exports = {
    Definition,
    API: Api,
    Config
};
