const nodemailer = require('nodemailer');
require('dotenv').config();

let cachedTransporter = null;
let lastConfigHash = '';

async function getEmailTransporter() {
  // Always refresh dotenv in case .env was edited
  require('dotenv').config({ override: true });

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';

  const currentConfigHash = `${host}:${port}:${user}:${pass}:${secure}`;

  if (cachedTransporter && currentConfigHash === lastConfigHash) {
    return cachedTransporter;
  }

  if (host && user && pass) {
    console.log(`[EMAIL] Initializing Real SMTP Transport for ${user} via ${host}:${port}...`);
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass
      }
    });
    lastConfigHash = currentConfigHash;
  } else {
    console.log('[EMAIL] No custom SMTP configured. Initializing Ethereal Test/Preview Mailer...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      cachedTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      lastConfigHash = currentConfigHash;
      console.log(`[EMAIL] Ethereal test mailer ready: ${testAccount.user}`);
    } catch (err) {
      console.warn('[EMAIL] Failed to create Ethereal account, falling back to JSON stream mailer:', err.message);
      cachedTransporter = nodemailer.createTransport({
        jsonTransport: true
      });
      lastConfigHash = currentConfigHash;
    }
  }

  return cachedTransporter;
}

module.exports = {
  getEmailTransporter
};
