const _ = require('lodash');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const tokenProvider = require('axios-token-interceptor');
const { ConcurrencyManager } = require('axios-concurrency');
const chalk = require('chalk');
const ms = require('ms');

const logger = require('./logger').getInstance();

const DEFAULT_TIMEOUT = 20000;
const DEFAULT_TOKEN_EXPIRES = 180000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_CONCURRENT = 100;
const DEFAULT_PATRON_SEARCH_COUNT = 10;

const PATRON_INCLUDE_FIELDS = [
  'profile',
  'birthDate',
  'library',
  'alternateID',
  'firstName',
  'middleName',
  'displayName',
  'lastName',
  'address1',
  'barcode',
  'category01',
  'category02',
  'category07',
  'customInformation'
];

class ILSWS {
  constructor(config) {
    this._config = config;
    this._baseUrl = `https://${config.ilsws.hostname}:${config.ilsws.port}/${config.ilsws.webapp}`;
    this._originatingAppId = 'libconnected';

    const apiConfig = {
      baseURL: this._baseUrl,
      timeout: ms(config.ilsws.timeout) || DEFAULT_TIMEOUT,
      headers: {
        'sd-originating-app-id': this._originatingAppId, 
        'x-sirs-clientID': config.ilsws.client_id,
        'Accept': 'application/json'
      }
    };

    const retryConfig = {
      retryDelay: axiosRetry.exponentialDelay,
      retries: config.ilsws.max_retries || DEFAULT_MAX_RETRIES
    };

    this._apiNoAuth = axios.create(apiConfig);
    this._api = axios.create(apiConfig);

    axiosRetry(this._apiNoAuth, retryConfig);
    axiosRetry(this._api, retryConfig);

    const logInterceptorResponse = (response) => {
      const responseTime = Date.now() - response.config['axios-retry'].lastRequestTime;
      const statusCode = response.status === 200 ? chalk.green('200') : chalk.red(response.statusText);
      const backend = `${chalk.blueBright('ILSWS')} =>`;

      logger.debug(`${backend} ${chalk.cyan(response.config.method)} ${response.config.url} ${statusCode} (${responseTime}ms)`);
      return response;
    };

    const logInterceptorError = (error) => {
      try {
      const responseTime = Date.now() - error.config['axios-retry'].lastRequestTime;
      const statusCode = chalk.red(error.response.statusText);
      const backend = `${chalk.blueBright('ILSWS')} =>`;

      logger.debug(`${backend} ${chalk.cyan(error.config.method)} ${error.config.url} ${statusCode} (${responseTime}ms)`)     
      const maybeILSWSError = _.get(error, 'response.data');
      if (maybeILSWSError) logger.error(chalk.red(JSON.stringify(maybeILSWSError)));

      return Promise.reject(error);

      }
      catch (e) { console.log(e)}
    };

    this._api.interceptors.response.use(logInterceptorResponse, logInterceptorError);
    this._apiNoAuth.interceptors.response.use(logInterceptorResponse, logInterceptorError);

    const tokenCache = tokenProvider.tokenCache(() => {
      return this.loginUser(config.ilsws.username, config.ilsws.password)
        .then(loginUserRsp => {
          if (!_.get(loginUserRsp, 'data.sessionToken')) {
            logger.error(`TOKEN_PROVIDER_ERROR ${_.get(loginUserRsp, 'data.faultResponse.string')}`);
            throw loginUserRsp.data;
          }

          return loginUserRsp.data.sessionToken;
        })
        .catch(err => logger.error(err.message));

    }, { maxAge: ms(config.ilsws.token_expires) || DEFAULT_TOKEN_EXPIRES });

    this._api.interceptors.request.use(config => {
       return tokenProvider({
         header: 'x-sirs-sessionToken',
         headerFormatter: (token) => token,
         getToken: tokenCache
       })(config);
    }, err => Promise.reject(err));

    this._manager = ConcurrencyManager(this._api, config.ilsws.max_concurrent || DEFAULT_MAX_CONCURRENT);
  }

  aboutIlsWs() {
    return this._apiNoAuth.get('aboutIlsWs');
  }

  loginUser(username, password) {
    return this._apiNoAuth.post('rest/security/loginUser', {}, {
      baseURL: this._baseUrl,
      params: { login: username, password: password }
    });
  }

  patronSearch(index, value, count = DEFAULT_PATRON_SEARCH_COUNT) {
    const settings = {
      params: {
        q: `${index}:'${value}'`,
        rw: 1,
        ct: count,
        includeFields: PATRON_INCLUDE_FIELDS.join()
      }
    };

    return this._api.get('user/patron/search', settings)
      .then(rsp => rsp.data.result)
      .catch(err => {
        if (_.get(err, 'response.status') === 400) return [];
        // TODO: 500 - "Unavailable for display" <-- user exists but indexed yet
        if (_.get(err, 'response.status') === 500) return [];
        return err;
      });
  }

  getPatronByAlternateId(altId) {
    return this.patronSearch('ALT_ID', altId, 1)
      .then(patron => patron[0] || null);
  }

  getPatronByBarcode(barcode) {
    const settings = {
      params: {
        includeFields: PATRON_INCLUDE_FIELDS.join()
      }
    };

    return this._api.get(`user/patron/barcode/${barcode}`, settings)
      .then(rsp => rsp.data)
      .catch(err => {
        if (_.get(err, 'response.status') === 404) return null;
        return err;
      });
  }

  patronCreate(patronData) {
    const settings = {
      headers: {
        'SD-Prompt-Return': `USER_PRIVILEGE_OVRCD/${this._config.ilsws.user_privilege_override}`
      }
    };

    return this._api.post('user/patron', patronData, settings)
      .then(rsp => rsp.data);
  }

  patronUpdate(patronData) {
    const settings = {
      headers: {
        'SD-Prompt-Return': `USER_PRIVILEGE_OVRCD/${this._config.ilsws.user_privilege_override}`
      }
    };

    return this._api.put(`user/patron/key/${patronData.key}`, patronData, settings);
  }
}

let instance;

module.exports = {
  getInstance(config) {
    if (!instance) {
      instance = new ILSWS(config);
    }

    return instance;
  }
};
