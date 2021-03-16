const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const shell = require('shelljs');

const config = YAML.parse(fs.readFileSync('../config.yaml', 'utf-8'));

_.each(config.clients, client => {
  const nid = `${client.namespace}${client.id}`;
  const homeDir = path.join(config.incoming_path, nid);
  const incomingDir = path.join(homeDir, 'incoming');
  const sshDir = path.join(homeDir, '.ssh');
  const keyFile = path.join(sshDir, 'authorized_keys');

  console.log(`Creating user ${nid}...`);

  shell.exec(`useradd -d ${homeDir} -s /sbin/nologin ${nid}`);
  shell.exec(`groupadd sftponly`);
  shell.exec(`gpasswd -a sftponly ${nid}`);
  shell.exec(`chmod a+rx ${homeDir}`);
  shell.exec(`chmod a+rx ${incomingDir}`);
  shell.mkdir('-p', incomingDir);
  shell.exec(`chown ${nid}:${config.service_account} ${incomingDir}`);
  shell.exec(`chmod g+ws ${incomingDir}`);
  shell.mkdir('-p', sshDir);
  fs.writeFileSync(keyFile, client.authorized_key);
  shell.exec(`chmod 700 ${sshDir}`);
  shell.exec(`chmod 644 ${keyFile}`);
  shell.exec(`chown -R ${nid}:${nid} ${sshDir}`);

  console.log('\n');
});
