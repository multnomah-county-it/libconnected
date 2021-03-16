const _ = require('lodash');
const fs = require('fs');
const YAML = require('yaml');

const config = YAML.parse(fs.readFileSync('config.yaml', 'utf8'));
config.clients = _.keyBy(config.clients, c => `${c.namespace}:${c.id}`);

const logger = require('./src/lib/logger').getInstance(config);

const LCServer = require('./src/server');

const server = new LCServer(config);

server.start();
