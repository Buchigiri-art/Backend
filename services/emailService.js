// services/emailService.js
const axios = require('axios');
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.brevoApiKey = process.env.BREVO_API_KEY || null;

    // Keep raw env value (may be "Name <email@domain.com>" or "email@domain.com")
    this.rawFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@example.com';

    // parse rawFrom into { name, email }
    const parsed = this._parseFrom(this.rawFrom);
    this.defaultFromName = parsed.name;   // e.g. "Ram" or "Teacher"
    this.defaultFromEmail = parsed.email; // e.g. "bhushan.poojary2006@gmail.com"

    this.useSmtpFallback = String(process.env.USE_SMTP || 'false').toLowerCase() === 'true';

    this.smtpHost = process.env.BREVO_SMTP_HOST || process.env.SMTP_HOST || 'smtp-relay.brevo.com';
    this.smtpPort = Number(process.env.BREVO_SMTP_PORT || process.env.SMTP_PORT || 587);
    this.smtpSecure = String(this.smtpPort) === '465';
    this.smtpUser = process.env.BREVO_SMTP_USER || process.env.EMAIL_USER;
    this.smtpPass = process.env.BREVO_SMTP_PASS || process.env.EMAIL_PASSWORD;

    this.transporter = null;
    if (this.useSmtpFallback) {
      if (!this.smtpUser || !this.smtpPass) {
        console.warn('SMTP fallback enabled but SMTP_USER/SMTP_PASS not set.');
      }
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: { user: this.smtpUser, pass: this.smtpPass },
        logger: process.env.NODE_ENV === 'development',
        debug: process.env.NODE_ENV === 'development'
      });
    }

    console.log('EmailService initialized — Brevo API:', !!this.brevoApiKey, 'SMTP fallback:', this.useSmtpFallback);
    console.log('Default sender parsed as:', this.defaultFromName, '<' + this.defaultFromEmail + '>');
  }

  // Parses "Name <email@domain.com>" or "email@domain.com" into {name, email}
  _parseFrom(raw) {
    if (!raw) return { name: 'Teacher', email: 'no-reply@example.com' };
    // Trim and remove surrounding quotes
    const s = String(raw).trim().replace(/^"(.*)"$/, '$1');
    // Try to match <email>
    const angleMatch = s.match(/^(.*)<\s*([^>]+)\s*>$/);
    if (angleMatch) {
      const name = (angleMatch[1] || '').replace(/["']/g, '').trim() || null;
      const email = (angleMatch[2] || '').trim();
      return { name: name || 'Teacher', email };
    }
    // Try to find email inside string (fallback)
    const emailMatch = s.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      // name = full string without email part
      const email = emailMatch[1];
      const namePart = s.replace(email, '').replace(/[<>"]/g, '').trim();
      return { name: namePart || 'Teacher', email };
    }
    // fallback
    return { name: 'Teacher', email: s };
  }

  _buildHtml(quizTitle, uniqueLink, teacherName) {
    const teacher = teacherName || 'Teacher';
    return `<!DOCTYPE html>
      <html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1" />
      <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0}.content{background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px}.button{display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:6px;margin:16px 0;font-weight:bold}.footer{text-align:center;margin-top:20px;color:#666;font-size:12px}.info-box{background:white;padding:12px;border-left:4px solid #667eea;margin:12px 0;border-radius:4px}a{color:#2a56c6;word-break:break-all}</style>
      </head><body>
      <div class="container">
        <div class="header"><h1>📝 Quiz Invitation</h1></div>
        <div class="content">
          <h2>Hello!</h2>
          <p>You have been invited by <strong>${teacher}</strong> to attempt a quiz titled <strong>${quizTitle}</strong>.</p>
          <div class="info-box"><h3 style="margin:0 0 6px 0;">Quiz: ${quizTitle}</h3><p style="margin:0;">Click the button below to access your personalized quiz link.</p></div>
          <p style="text-align:center;"><a href="${uniqueLink}" class="button" target="_blank" rel="noopener noreferrer">Start Quiz</a></p>
          <p><strong>Important Instructions:</strong></p>
          <ul><li>This link is unique to you and should not be shared</li><li>You'll need to enter your details before starting</li><li>Complete the quiz within the allocated time</li><li>Make sure you have a stable internet connection</li></ul>
          <div class="info-box"><p style="margin: 0;"><strong>Link:</strong> <a href="${uniqueLink}">${uniqueLink}</a></p></div>
          <p>Good luck with your quiz!</p>
        </div>
        <div class="footer"><p>This is an automated email. Please do not reply.</p></div>
      </div>
      </body></html>`;
  }

  async _sendViaBrevo(studentEmail, quizTitle, uniqueLink, teacherName) {
    if (!this.brevoApiKey) {
      throw new Error('BREVO_API_KEY not configured');
    }

    const htmlContent = this._buildHtml(quizTitle, uniqueLink, teacherName);

    // Use parsed default email and a sensible name:
    const senderEmail = this.defaultFromEmail;
    // prefer teacherName for display name, then defaultFromName
    const senderName = teacherName || this.defaultFromName || 'Teacher';

    const payload = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: studentEmail }],
      subject: `Quiz Invitation: ${quizTitle}`,
      htmlContent
    };

    try {
      const res = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: { 'api-key': this.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 10000
      });
      const data = res && res.data ? res.data : {};
      return { success: true, messageId: data.messageId || data['message-id'] || null, raw: data };
    } catch (err) {
      const reason = err.response?.data || err.message || String(err);
      console.error('Brevo API send error:', reason);
      throw new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));
    }
  }

  async _sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName) {
    if (!this.transporter) throw new Error('SMTP transporter not configured');
    const htmlContent = this._buildHtml(quizTitle, uniqueLink, teacherName);
    const mailOptions = { from: `"${teacherName || this.defaultFromName}" <${this.defaultFromEmail}>`, to: studentEmail, subject: `Quiz Invitation: ${quizTitle}`, html: htmlContent };
    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`SMTP email sent to ${studentEmail}: ${info.messageId}`);
      return { success: true, messageId: info.messageId, raw: info };
    } catch (error) {
      console.error(`SMTP send error to ${studentEmail}:`, error && error.message ? error.message : error);
      throw new Error(error && error.message ? error.message : 'Unknown SMTP error');
    }
  }

  async sendQuizInvitation(studentEmail, quizTitle, uniqueLink, teacherName) {
    if (!studentEmail) throw new Error('studentEmail is required');

    if (this.brevoApiKey) {
      try {
        const res = await this._sendViaBrevo(studentEmail, quizTitle, uniqueLink, teacherName);
        console.log(`Brevo: Email sent to ${studentEmail}`, res.messageId || '');
        return res;
      } catch (brevoErr) {
        console.warn(`Brevo send failed for ${studentEmail}:`, brevoErr.message || brevoErr);
        if (this.useSmtpFallback && this.transporter) {
          try {
            return await this._sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName);
          } catch (smtpErr) {
            console.error('Both Brevo and SMTP failed:', smtpErr);
            throw new Error(`Failed to send to ${studentEmail}: Brevo error: ${brevoErr.message || brevoErr} | SMTP error: ${smtpErr.message || smtpErr}`);
          }
        }
        throw new Error(`Failed to send to ${studentEmail}: ${brevoErr.message || brevoErr}`);
      }
    }

    if (this.useSmtpFallback && this.transporter) {
      return this._sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName);
    }

    throw new Error('No email sending method configured (set BREVO_API_KEY or enable USE_SMTP with SMTP credentials).');
  }

  async verifyConnection() {
    if (this.brevoApiKey) {
      try {
        const res = await axios.get('https://api.brevo.com/v3/account', {
          headers: { 'api-key': this.brevoApiKey, Accept: 'application/json' },
          timeout: 8000
        });
        if (res && res.status === 200) {
          console.log('Brevo API verified and reachable');
          return true;
        }
        console.warn('Brevo API responded with non-200 status', res.status);
        return false;
      } catch (err) {
        console.error('Brevo API verify failed:', err.response?.data || err.message || err);
        return false;
      }
    }

    if (this.transporter) {
      try {
        await this.transporter.verify();
        console.log('SMTP transporter verified');
        return true;
      } catch (err) {
        console.error('SMTP verify failed:', err && err.message ? err.message : err);
        return false;
      }
    }

    console.warn('No email provider configured for verifyConnection');
    return false;
  }
}

module.exports = new EmailService();
