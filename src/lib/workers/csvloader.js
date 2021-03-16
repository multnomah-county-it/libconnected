const _ = require('lodash');
const fs = require('fs');
const parse = require('csv-parse');
const yup = require('yup');

const logger = require('../logger').getInstance();
const ljm = require('../logger').logJobMessage;

class CSVLoader {
  constructor(config, queue) {
    this._config = config;
    this._queue = queue;
  }

  processHandler(job) {
    ljm('debug', job, 'CSV_PARSE_PROCESS', job.data.path);

    const csvSchema = require(`./schema/${job.data.client.schema}`);

    return new Promise((resolve, reject) => {
      const parser = parse({
        trim: true,
        bom: true,
        columns: header => header.map(column => column.toLowerCase())
      });

      const data = [];
      let record;

      job.data.validationErrors = [];

      parser.on('readable', () => {
        while (record = parser.read()) {
          record = _.mapKeys(record, (v, k) => k.toLowerCase());

          if (csvSchema.isValidSync(record)) {
            data.push(record);
          } else {
            try {
              csvSchema.validateSync(record, { abortEarly: false })
            } catch (e) {
              ljm('error', job, 'CSV_VALIDATION_ERROR', e.errors.join(','));

              job.data.validationErrors.push({ record, errors: _.clone(e.errors) });
            }
          }
        }
      });

      parser.on('error', err => {
        ljm('error', job, 'CSV_PARSE_ERROR', err.message);
        return reject(err);
      });

      parser.on('end', () => {
        return resolve({ job: job, value: data })
      });

      fs.createReadStream(job.data.path).pipe(parser);
    });
  }
}

module.exports = CSVLoader;
