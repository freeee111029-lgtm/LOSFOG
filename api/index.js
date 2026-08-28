const express = require('express');
const app = require('../index');
const { createServer } = require('http');

module.exports = async (req, res) => {
  const server = createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      server.emit('request', req, res);
      resolve();
    });
  })
}
