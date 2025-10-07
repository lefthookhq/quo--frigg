const { Definition } = require('./definition.js');

module.exports = {
    Definition,
    Config: {
        name: Definition.getName(),
        description: 'AxisCare API integration for client management and scheduling',
        logoUrl: '',
    },
};
