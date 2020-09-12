class CancelException extends Error {
  constructor(...args) {
    super(...args);
    this.name = 'CancelException';
  }
}

module.exports = CancelException;
