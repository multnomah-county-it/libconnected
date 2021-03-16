const x_X = String.raw`
   ___ __                              __         __
  / (_) /  _______  ___  ___  ___ ____/ /____ ___/ /
 / / / _ \/ __/ _ \/ _ \/ _ \/ -_) __/ __/ -_) _  / 
/_/_/_.__/\__/\___/_//_/_//_/\__/\__/\__/\__/\_,_/  
`;

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');
const { performance } = require('perf_hooks');
const ejs = require('ejs');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const hasha = require('hasha');
const prettyBytes = require('pretty-bytes');

const logger = require('./lib/logger').getInstance();
const LCQueue = require('./lib/queue');
const ILSWS = require('./lib/ilsws');

class LCServer {
  constructor(config) {
    this._config = config;
    this._ilsws = ILSWS.getInstance(this._config);

    this._watchers = [];
    this._queue = new LCQueue(config);

    this._transporter = nodemailer.createTransport({
      host: config.smtp.hostname,
      port: config.smtp.port
    });
  }

  handleIncomingFile(evt, filePath, stat) {
    if (evt === 'add') {
      if (path.extname(filePath) === '.filepart') return;

      const fileSize = prettyBytes(stat.size);

      const dir = path.dirname(path.dirname(filePath));
      const baseDir = path.basename(dir);

      const [ namespace, id ] = baseDir.match(/[a-z]+|[^a-z]+/gi);
      const nid = `${namespace}:${id}`;

      const client = this._config.clients[nid];

      const uuid = uuidv4();
      const startTime = performance.now();
      const startTimestamp = moment().tz(this._config.local_timezone).format();

      const validationErrors = [];

      let checksum;

      logger.info(`[${chalk.magenta(uuid)}] ${chalk.whiteBright('INGEST_STARTED')} ${filePath}`);

      hasha.fromFile(filePath, { algorithm: 'sha1' })
        .then(hash => {
          checksum = hash;

          return this._queue.runJob(client.loader, { uuid: uuid, client: client, path: filePath });
        })
        .then(result => {
          validationErrors.push(...result.job.data.validationErrors);

          return Promise.all(result.value.map(record => this._queue.runJob(client.processor, {
            uuid: uuid,
            client: client,
            record: record
          })));
        })
        .then(results => {
          const sorted = _.groupBy(results, result => {
            return result.value.foundIn;
          });

          const runtime = _.round(performance.now() - startTime, 3);

          logger.info(`[${chalk.magenta(uuid)}] ${chalk.whiteBright('INGEST_COMPLETED')} ${runtime}ms`);

          const reportFields = {
            _,
            banner: x_X,
            results: sorted,
            validationErrors,
            filePath, fileSize, checksum,
            uuid, nid,
            clientInfo: client,
            runtime, startTimestamp, endTimestamp: moment().tz(this._config.local_timezone).format()
          };

          this.sendCompletedReport(reportFields);
          if (!client.preserve_uploads) this.removeFile(filePath);
        })
        .catch(e => {
          logger.error(e);
          this.sendErrorReport({ error: e, client, nid, uuid, filePath, checksum, banner: x_X });
          if (!client.preserve_uploads) this.removeFile(filePath);
        });
    }
  }

  registerWatchers() {
    logger.info('REGISTER_WATCHERS:');

    _.forOwn(this._config.clients, (v, k) => {
      const wp = path.join(this._config.incoming_path, `${v.namespace}${v.id}`, 'incoming');

      const w = chokidar.watch(wp, {
        ignored: /(^|[\/\\])\../,
        persistant: true,
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: true
      }).on('all', this.handleIncomingFile.bind(this));

      this._watchers.push(w);

      logger.info(`[${v.namespace}:${v.id}, ${v.name}, ${v.contact}]`);
      logger.info(`\t${chalk.blueBright('`-->')} ${chalk.greenBright(wp)}`);
    });

    logger.info(`WATCHING ${chalk.greenBright(this._config.incoming_path)}...`);
  }

  sendCompletedReport(fields) {
    ejs.renderFile(path.join(__dirname, 'templates/report.template'), fields, (err, str) => {
      if (err) throw err;

      this._transporter.sendMail({
        from: this._config.smtp.from,
        to: this._config.admin_contact,
        subject: `LIBCONNECTED INGEST REPORT (${fields.nid}) [${fields.uuid}]`,
        text: str,
        html: `<pre>${str}</pre>`,
      }, (err, info) => {
        if (err) logger.error(err);
        const response = _.get(info, 'response');
        if (response) logger.info(response);
      });
    });
  }

  sendErrorReport(fields) {
    ejs.renderFile(path.join(__dirname, 'templates/error.template'), fields, (err, str) => {
      if (err) throw err;

      this._transporter.sendMail({
        from: this._config.smtp.from,
        to: this._config.admin_contact,
        subject: `LIBCONNECTED INGEST FAILED (${fields.nid}) [${fields.uuid}]`,
        text: str,
        html: `<pre>${str}</pre>`,
      }, (err, info) => {
        if (err) logger.error(err);
        const response = _.get(info, 'response');
        if (response) logger.info(response);
      });
    });
  }

  removeFile(filePath) {
    fs.unlink(filePath, err => {
      if (err) logger.error(err);
    });
  }

  start() {
    const colorRamp = [
      '#000000',
      '#ffd319',
      '#ff901f',
      '#ff2975',
      '#f222ff',
      '#000000'
    ];

    x_X.split('\n').forEach((e, i) => console.log(`${ chalk.hex(colorRamp[i])(e) }`));

    this._ilsws
      .aboutIlsWs()
      .then(aboutRsp => aboutRsp.data)
      .then(aboutData => {
        _.get(aboutData, 'fields.product').forEach(v => {
          logger.info(`${v.name.toLowerCase().replace('-','_')}: ${v.version}`);
        });


        logger.info(`ILSWS_STATUS: ${chalk.greenBright('ONLINE')}`);
      })
      .catch(err => {
        logger.error(`ILSWS_STATUS: ${chalk.red('OFFLINE')}`);
        logger.error(err.message);
        process.exit(1);
      })
      .then(() => this.registerWatchers());
  }
}

module.exports = LCServer;
