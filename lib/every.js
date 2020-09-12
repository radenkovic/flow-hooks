const Promise = require('bluebird');

const every = (arr) => async (ctx) => {
  const promises = arr.map((p) => p(ctx));
  await Promise.all(promises);
  return ctx;
};

module.exports = every;
