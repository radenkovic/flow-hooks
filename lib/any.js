const Promise = require('bluebird');

const any = (arr) => async (ctx) => {
  const promises = arr.map((p) => p(ctx));
  await Promise.any(promises);
  return ctx;
};

module.exports = any;
