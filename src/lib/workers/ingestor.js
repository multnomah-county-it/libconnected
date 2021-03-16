const _ = require('lodash');
const moment = require('moment');

const ILSWS = require('../ilsws').getInstance();
const logger = require('../logger').getInstance();
const ljm = require('../logger').logJobMessage;

const addCategoryDefaults = (patron, categoryDefaults) => {
  _.forOwn(categoryDefaults, (v, k) => {
    const catId = _.padStart(k, 2, '0');

    patron.fields[`category${catId}`] = {
      resource: `/policy/patronCategory${catId}`,
      key: v
    };
  });
};

const getResourceField = (dataFields, field, key) => {
  const item = dataFields[field].find((item) => item.fields.code.key === key);
  return (item && item.fields.data) || '';
};

const createAddressEntry = (k, v) => {
  return {
    resource: '/user/patron/address1',
    fields: {
      code: {
        resource: '/policy/patronAddress1',
        key: k
      },
      data: v
    }
  }
};

const setActiveID = (patron) => {
  const customInfo = _.get(patron, 'fields.customInformation') || [];
  const activeIdInfo = _.find(customInfo, i => _.get(i, 'fields.code.key') === 'ACTIVEID');

  if (!customInfo || !activeIdInfo) logger.error('ASSERT ERROR: customInfo || activeIdInfo');

  let activeIds = _.filter((activeIdInfo.fields.data || '').split(','), i => !_.isEmpty(i));

  if (!_.includes(activeIds, patron.fields.barcode)) activeIds.push(patron.fields.barcode);

  if (patron.fields.barcode !== patron.fields.alternateID) {
    if (!_.includes(activeIds, patron.fields.alternateID)) activeIds.push(patron.fields.alternateID);
  }

  activeIdInfo.fields.data = activeIds.join(',');
};

const removeNullCustomInformation = (patron) => {
  const customInfo = _.get(patron, 'fields.customInformation') || [];

  patron.fields.customInformation = _.filter(customInfo, i => {
    return _.get(i, 'fields.data') !== null;
  });
};

const removeNullAddressResource = (patron) => {
  const address1 = _.get(patron, 'fields.address1') || [];

  patron.fields.address1 = _.filter(address1, i => {
    return _.get(i, 'fields.data') !== null;
  });
};


const normalizeStreetAddress = (streetAddress, defaults) => {
  return _.reduce(defaults.address_replace_map, (r, v, k) =>
    r.replace(new RegExp(k, 'ig'), v), streetAddress);
};

const address1Map = (record, defaults, patron) => {
  const currentEmail = patron && patron.fields ? getResourceField(patron.fields, 'address1', 'EMAIL') : '';
  const address1Mapping = [
    [ 'STREET', r => {
      return _.includes(['', 'ADDRESS SUPPRESSED'], (r.address || '').toUpperCase()) ?
        defaults.suppressed_address :
        normalizeStreetAddress(r.address, defaults);
    }],
    [ 'CITY/STATE', r => `${r.city || defaults.city}, ${r.state || defaults.state}` ],
    [ 'EMAIL', r => currentEmail || r.email || ''],
    [ 'ZIP', r => `${r.zipcode || defaults.zipcode}` ]
  ];

  return address1Mapping.map(([a, b]) => {
    const v = (typeof b === 'function') ? b(record) : record[b];
    return createAddressEntry(a, v);
  });
}

class Ingestor {
  constructor(config, queue) {
    this._config = config;
    this._queue = queue;
  }

  processHandler(job) {
    return new Promise((resolve, reject) => {
      ljm('debug', job, 'INGESTOR_RUN');

      const maybeId = `${job.data.client.id}${job.data.record.student_id}`;
    
      this.findAsPatron(maybeId, job.data.record)
        .then(({ foundIn, patron, ambiguous }) => {
          if (!foundIn) {
            // not found
            return this.createPatron(job.data.client, maybeId, job.data.record)
              .then((patron) => {
                return resolve({ job, value: { foundIn: 'new', patron }});
              });
          }

          if (ambiguous.length === 0) {
            return this.overlayPatron(job.data.client, maybeId, job.data.record, patron)
              .then((overlayResponse) => {
            		if (overlayResponse.dataTooLong) {
            		  return resolve({ job, value: { foundIn: 'dataTooLong', patron }});
            		}

                return resolve({ job, value: { foundIn, patron }});
              });
          } else {
            return resolve({ job, value: { foundIn: 'ambiguous', patron, ambiguous }});
          }

        })
        .catch(err => resolve({job, value: { foundIn: 'error', err }}));
    });
  }

  recordToPatron(id, record, defaults) {

    const patron = {
      resource: '/user/patron',
      fields: {
        barcode: id,
        birthDate: moment(record.dob, 'MM/DD/YYYY').format('YYYY-MM-DD'),
        firstName: record.first_name,
        middleName: record.middle_name,
        lastName: record.last_name,
        address1: address1Map(record, this._config.global_defaults),
        library: {
          resource: '/policy/library',
          key: defaults.home_library
        },
        profile: {
          resource: '/policy/userProfile',
          key: defaults.user_profile
        },
        pin: moment(record.dob, 'MM/DD/YYYY').format('MMDDYYYY')
      }
    };

    addCategoryDefaults(patron, defaults.user_categories);

    return patron;
  }

  overlayPatron(client, id, record, patron) {
    addCategoryDefaults(patron, client.overlay_defaults.user_categories);

    const preserveFields = _.filter(patron.fields.address1, a => {
      return _.includes(['PHONE', 'EMAIL'], _.get(a, 'fields.code.key'));
    });

    patron.fields.address1 = address1Map(record, this._config.global_defaults, patron);

    patron.fields.address1.push(...preserveFields);

    patron.fields.library = {
      resource: '/policy/library',
      key: client.overlay_defaults.home_library
    };

    patron.fields.profile = {
      resource: '/policy/userProfile',
      key: client.overlay_defaults.user_profile
    };

    patron.fields.alternateID = id;
    setActiveID(patron);
    removeNullCustomInformation(patron);
    removeNullAddressResource(patron);

    if (this._config.global_defaults.overlay_pins) {
      patron.fields.pin = moment(record.dob, 'MM/DD/YYYY').format('MMDDYYYY');
    }
   
    const tooLong = _.find(_.get(patron, 'fields.customInformation') || [], v => {
      return (_.get(v, 'fields.data') || '').length > 249;
    });

    if (tooLong) return Promise.resolve({ dataTooLong: true});

    return ILSWS.patronUpdate(patron);
  }

  createPatron(client, id, record) {
    return ILSWS.patronCreate(this.recordToPatron(id, record, client.new_defaults));
  }

  findAsPatron(maybeId, record) {
    let foundIn;
    let ambiguous = [];

    const maybePatron = (maybePatron, where) => {
      if (!foundIn && maybePatron) foundIn = where;
      return maybePatron;
    };

    return ILSWS.getPatronByBarcode(maybeId)
      .then(result => maybePatron(result, 'barcode'))
      .then(result => result || ILSWS.getPatronByAlternateId(maybeId))
      .then(result => maybePatron(result, 'alternateId'))
      .then(result => result || ILSWS.patronSearch('NAME', `'${record.last_name.replace(/[ ,]/g, '*')}'|'${record.first_name.replace(/[ ,]/g, '*')}'`), 10)
      .then(result => {
        if (!_.isArray(result)) return result;

        const lcOptions = {
          ignorePunctuation: true,
          sensitivity: 'accent'
        };

        const matches = _.filter(result, e => {
          return record.first_name.localeCompare(_.get(e, 'fields.firstName'), undefined, lcOptions) === 0 &&
            record.last_name.localeCompare(_.get(e, 'fields.lastName'), undefined, lcOptions) === 0 &&
            moment(record.dob, 'MM/DD/YYYY').isSame(moment(_.get(e, 'fields.birthDate')), 'day');
        });

        if (matches.length > 1) ambiguous.push(...matches);
        
        return matches[0];
      })
      .then(result => maybePatron(result, 'fuzzy'))
      .then(result => ({ foundIn: foundIn, patron: result, ambiguous: ambiguous }));
  }
}

module.exports = Ingestor;
