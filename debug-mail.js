const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });
const nodemailer = require('nodemailer');

const authMethod = (process.env.SMTP_AUTH_METHOD || 'login').toLowerCase();

let transporterConfig;

if (authMethod === 'oauth2') {
  transporterConfig = {
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.SMTP_MAIL,
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      refreshToken: process.env.OAUTH_REFRESH_TOKEN,
    },
    logger: true,
    debug: true,
  };
} else {
  transporterConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_MAIL,
      pass: process.env.SMTP_PASSWORD,
    },
    logger: true,
    debug: true,
  };
  if (process.env.SMTP_SERVICE) transporterConfig.service = process.env.SMTP_SERVICE;
}

const safeConfig = { ...transporterConfig };
if (safeConfig.auth && safeConfig.auth.pass) safeConfig.auth = { ...safeConfig.auth, pass: '(redacted)' };

console.log('SMTP_AUTH_METHOD=', authMethod);
console.log('Transporter config (redacted):', safeConfig);

const transporter = nodemailer.createTransport(transporterConfig);

transporter.verify((err, success) => {
  if (err) {
    console.error('SMTP verify failed:');
    console.error(err);
    process.exitCode = 1;
  } else {
    console.log('SMTP verify success — server is ready to send messages');
  }
});
