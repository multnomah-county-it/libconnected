![libconnected logo](extras/banner.png)

# Automated Patron Transform and Load

### About

Created initially to support the [ConnectED Library](https://www.imls.gov/issues/national-initiatives/connected-library-challenge) initiative, `libconnected` automates ILS patron account validation, transformation, ingestion, and reporting.

`libconnected` supports ingesting any number of third-party data sources as ILS patrons, with custom settings and namespaced ID prefixes per client.

Plugins can be defined to support any file format, with schema validation and custom ingestion logic.

![Diagram](/images/diagram_public.png)

### Features

* Pluggable Transform/Load Logic (currently supporting *Symphony ILSWS*)
* Custom Schema Validation
* Ingestion Process Namespacing
* Automated SFTP Account and Directory Creation
* Alternate ID and Fuzzy Matching Overlays for Existing Accounts
* Emailed Post-Ingestion Reports
* Queued Processing Supporting Throttling and Failure Recovery

### Requirements

* Node v13.13.0
* Redis 4.0.10

### Install

```
> git clone https://github.com/alivesay/libconnected
> cd libconnected
> npm install
```

### Config

- `log_level`: info, warn, error, debug
- `service_account`: username of system account `libconnected` is running as
- `incoming_path`: root path of directory to generate SFTP user accounts and watch for uploads
- `redis`:
  - `host`: hostname or IP for Redis instance
  - `port`: port for Redis instance
- `smtp`:
  - `from`: from address for all emails sent
  - `hostname`: SMTP server hostname
  - `port`: SMTP server port
- `admin_contact`: email address to receive copies of all emails sent
- `local_timezone`: your local timezone to convert from server's
- `global_defaults`: applied to all clients
  - `suppressed_address`: placeholder address to use for blank source addresses
  - `address_replace_map`: key/value object, occurrances in address matching key will be replaced with value
- `ilsws`: Symphony ILSWS API settings
  - `username`: ILSWS username
  - `password`: ILSWS password
  - `hostname`: ILSWS hostname
  - `port`: ILSWS port
  - `webapp`: ILSWS WEBAPP value
  - `client_id`: ILSWS CLIENT ID value
  - `user_privilege_override`: Symphony "override" value (required for setting PINs)
  - `timeout`: ILSWS REST API timeout value
  - `max_retries`: maximum ILSWS API retries
  - `max_concurrent`: maximum ILSWS API calls at any given time
  - `token_expires`: refresh time for ILSWS API tokens
- `clients`: configuration for `libconnected` clients
  - `- id`: ID prefix to use for accounts ingested by this client
  - `authorized_key`: client SSH pub key
  - `namespace`: used as prefix for client account
  - `schema`: name of schema validator to use
  - `loader`: name of worker for loading file (ex, 'csvloader')
  - `processor`: name of worker for transform and load (ex, 'ingestor')
  - `name`: display title for client
  - `contact`: email to receive ingestion reports
  - `new_defaults`: used for new patron accounts
    - `home_library`: XXX
    - `user_profile`: XXX
    - `user_categories`: sets default userCategoryXX values
      - `1`: XXX
      - `2`: XXX
  - `overlay_defaults`: used for existing patron accounts
    - `home_library`: XXX
    - `user_profile`: XXX
    - `user_categories`: sets default userCategoryXX values
      - `1`: XXX
      - `2`: XXX

### Creating SFTP System Account and Directories

```
> cd bin
> sudo node ./create_client_accounts.js
```

This assumes you will be using OpenSSH as your SFTP server, with an `/etc/ssh/sshd_config` containing:

```
Match group sftponly
  ChrootDirectory <config.incoming_path>
  X11Forwarding no
  AllowTcpForwarding no
  ForceCommand internal-sftp -u 0117
```

### Starting and Installing as a Service

`libconnected` uses PM2, which you can find the docs for [here](https://pm2.keymetrics.io/).

### Redis Queue

In the event `libconnected` crashes or is shutdown, incomplete ingestion processes are still retained in Redis and will continue once the server restarts successfully.

If you wish to clear current processes before restarting `libconnected`, run the following:
```
> redis-cli flushall
```
