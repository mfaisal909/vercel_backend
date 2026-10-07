const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });
const sendMail = require('./utils/sendMail');

(async () => {
  try {
    await sendMail({
      email: process.env.TEST_TO || 'recipient@example.com',
      subject: 'Test email from app',
      message: 'This is a test email sent from the application.',
    });
    console.log('Email sent successfully');
  } catch (err) {
    console.error('Failed to send email:', err);
    process.exitCode = 1;
  }
})();
