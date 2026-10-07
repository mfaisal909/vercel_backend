const nodemailer = require("nodemailer");

let google;
try {
  google = require('googleapis').google;
} catch (e) {
  // googleapis is optional; OAuth2 path will error if not installed.
}

const sendMail = async (options) => {
  let transporterConfig;

  const authMethod = (process.env.SMTP_AUTH_METHOD || 'login').toLowerCase();

  if (authMethod === 'oauth2') {
    if (!google) throw new Error('googleapis is required for OAuth2. Run: npm install googleapis');

    const { OAuth2 } = google.auth;
    const oauth2Client = new OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const accessTokenResponse = await oauth2Client.getAccessToken();
    const accessToken = accessTokenResponse && accessTokenResponse.token ? accessTokenResponse.token : accessTokenResponse;

    transporterConfig = {
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.SMTP_MAIL,
        clientId: process.env.OAUTH_CLIENT_ID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        refreshToken: process.env.OAUTH_REFRESH_TOKEN,
        accessToken,
      },
    };
  } else {
    transporterConfig = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_MAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    };

    if (process.env.SMTP_SERVICE) {
      transporterConfig.service = process.env.SMTP_SERVICE;
    }
  }

  const transporter = nodemailer.createTransport(transporterConfig);

  // `html` is optional, but a text-only body that consists of little more than a
  // bare link scores badly with spam classifiers, so callers should pass one.
  // The display name on the envelope sender gives the recipient something
  // recognisable in the inbox list; the address stays the authenticated mailbox
  // so SPF/DKIM keep aligning.
  const fromName = process.env.SMTP_FROM_NAME || "Shop Management";

  const mailOptions = {
    from: `"${fromName}" <${process.env.SMTP_MAIL}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    ...(options.html ? { html: options.html } : {}),
    ...(options.replyTo || process.env.SMTP_REPLY_TO
      ? { replyTo: options.replyTo || process.env.SMTP_REPLY_TO }
      : {}),
  };

  const info = await transporter.sendMail(mailOptions);

  // A recipient can be rejected (bad address, blocked by the provider) without
  // nodemailer throwing, so a "successful" send can still deliver nothing.
  // Throwing here stops callers from reporting a mail that was never sent.
  if (Array.isArray(info.rejected) && info.rejected.length > 0) {
    const error = new Error(
      `Recipient rejected by the mail server: ${info.rejected.length} address(es)`
    );
    error.rejected = info.rejected;
    error.rejectedErrors = info.rejectedErrors;
    throw error;
  }

  if (Array.isArray(info.accepted) && info.accepted.length === 0) {
    throw new Error("Mail server accepted no recipients");
  }

  console.log(
    `Mail sent to ${info.accepted.join(", ")} (id: ${info.messageId})`
  );

  return info;
};

module.exports = sendMail;
