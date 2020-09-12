// Utility function, not a hook
const Promise = require('bluebird');

const wait = (t) => new Promise((resolve) => setTimeout(resolve, t));

module.exports = wait;
