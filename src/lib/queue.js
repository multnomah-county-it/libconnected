const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Queue = require('bee-queue');

const logger = require('./logger').getInstance();
const ljm = require('./logger').logJobMessage;

const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_QUEUE_CONCURRENCY = 100;

const createQueue = (config, ns) => {
  const queue = new Queue(ns, {
    redis: {
      host: config.redis.host || DEFAULT_REDIS_HOST,
      port: config.redis.port || DEFAULT_REDIS_PORT
    }
  });

  queue.on('failed', (job, err) => {
    ljm('error', job, 'QUEUE_FAILED', job.id);
    logger.error(err);
  });

  queue.on('error', (err) => {
    ljm('error', undefined, 'QUEUE_ERROR', err.message);
  });

  queue.on('retrying', (job, err) => {
    ljm('debug', job, 'QUEUE_RETRY', err.message);
  });

  return queue;
};

const createProcessHandler = (handler) => {
  return (job) => {
    ljm('debug', job, 'PROCESS_JOB');
try{
    return handler(job);
} catch (e) { console.log(e)};
  };
};

class LCQueue {
  constructor(config) {
    this._config = config;
    this._workers = {};
    this._queues = {};

    const wp = path.join(__dirname, 'workers');
    
    _.each(_.filter(fs.readdirSync(wp), f => /^[^.].*.js$/.test(f)), w => {
      const name = path.parse(w).name;
      const module = require(path.join(wp, name));

      this._queues[name] = createQueue(config, name);
      this._workers[name] = new module(config, this); 
      this._queues[name].process(DEFAULT_QUEUE_CONCURRENCY, createProcessHandler(job => this._workers[name].processHandler(job)));
    });
  }

  runJob(worker, data) {
    return new Promise((resolve, reject) => {
      const job = this._queues[worker].createJob(data);

      job.on('succeeded', (result) => {
        ljm('debug', job, 'JOB_COMPLETED');
        return resolve(result);
      });

      job.on('failed', (err) => {
        ljm('error', job, 'JOB_FAILED', err.message);
        return reject(err);
      });

      job.on('retrying', (err) => {
        ljm('debug', job, 'JOB_RETRY', err.message);
        return reject(err);
      });

      job.save();

      ljm('debug', job, 'JOB_CREATED', worker);
    });
  }
}

module.exports = LCQueue;
