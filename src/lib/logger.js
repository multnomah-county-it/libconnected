const _ = require('lodash');
const winston = require('winston');
const chalk = require('chalk');

let instance;

module.exports = {

  getInstance(config) {
    if (!instance) {
      instance = winston.createLogger({
        level: config.log_level || 'info',
        format: winston.format.simple(),
        transports: [
          new winston.transports.Console()
        ]
      });
    }

    return instance;
  },

  logJobMessage(level, job, marker, message) {
    const uuid = _.get(job, 'data.uuid') ? `[${chalk.magenta(job.data.uuid)}] ` : '';
    const jobId = _.get(job, 'id') ? `{${job.id}} ` : '';
    const msg = message || '';

    instance[level](`${uuid}${chalk.whiteBright(marker)} ${jobId}${msg}`);
  }
};
