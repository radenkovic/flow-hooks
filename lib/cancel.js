const CancelFlow = require('./cancel-exception');

const cancel = (err) => () => {
  if (err) throw err;
  throw new CancelFlow();
};

module.exports = cancel;
