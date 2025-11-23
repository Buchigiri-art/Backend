// services/emailService.js
const axios = require('axios');
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.brevoApiKey = process.env.BREVO_API_KEY || null;
    this.rawFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@example.com';
    this.useSmtpFallback = String(process.env.USE_SMTP || 'false').toLowerCase() === 'true';

    // Parse sender information
    const parsed = this._parseFrom(this.rawFrom);
    this.defaultFromName = parsed.name;
    this.defaultFromEmail = parsed.email;

    // SMTP configuration
    this.smtpHost = process.env.BREVO_SMTP_HOST || process.env.SMTP_HOST || 'smtp-relay.brevo.com';
    this.smtpPort = Number(process.env.BREVO_SMTP_PORT || process.env.SMTP_PORT || 587);
    this.smtpSecure = String(this.smtpPort) === '465';
    this.smtpUser = process.env.BREVO_SMTP_USER || process.env.EMAIL_USER;
    this.smtpPass = process.env.BREVO_SMTP_PASS || process.env.EMAIL_PASSWORD;

    this.transporter = null;
    this.initializeTransporter();

    // Rate limiting
    this.rateLimit = {
      lastCall: 0,
      minInterval: 100, // ms between emails to avoid being flagged as spam
      queue: [],
      processing: false
    };

    // Monitoring
    this.metrics = {
      totalSent: 0,
      failedAttempts: 0,
      lastError: null
    };

    console.log('EmailService initialized:', {
      brevo: !!this.brevoApiKey,
      smtp: this.useSmtpFallback,
      sender: `${this.defaultFromName} <${this.defaultFromEmail}>`
    });
  }

  initializeTransporter() {
    if (this.useSmtpFallback) {
      if (!this.smtpUser || !this.smtpPass) {
        console.warn('SMTP fallback enabled but SMTP_USER/SMTP_PASS not set');
        return;
      }

      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        },
        pool: true, // Use connection pooling
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 10, // Max 10 emails per second
        logger: process.env.NODE_ENV === 'development',
        debug: process.env.NODE_ENV === 'development'
      });

      // Handle transporter errors
      this.transporter.on('error', (error) => {
        console.error('SMTP Transporter Error:', error);
        this.metrics.lastError = error.message;
      });
    }
  }

  // Parses "Name <email@domain.com>" or "email@domain.com" into {name, email}
  _parseFrom(raw) {
    if (!raw) {
      return { name: 'Quiz System', email: 'no-reply@example.com' };
    }

    const s = String(raw).trim().replace(/^"(.*)"$/, '$1');
    
    // Match "Name <email@domain.com>" format
    const angleMatch = s.match(/^(.*)<\s*([^>]+)\s*>$/);
    if (angleMatch) {
      const name = (angleMatch[1] || '').replace(/["']/g, '').trim();
      const email = (angleMatch[2] || '').trim();
      return {
        name: name || 'Quiz System',
        email: this._validateEmail(email) ? email : 'no-reply@example.com'
      };
    }

    // Extract email from string
    const emailMatch = s.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch && this._validateEmail(emailMatch[1])) {
      const email = emailMatch[1];
      const namePart = s.replace(email, '').replace(/[<>"]/g, '').trim();
      return {
        name: namePart || 'Quiz System',
        email
      };
    }

    // Final fallback
    return {
      name: 'Quiz System',
      email: this._validateEmail(s) ? s : 'no-reply@example.com'
    };
  }

  _validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  _sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  _buildHtml(quizTitle, uniqueLink, teacherName) {
    const safeQuizTitle = this._sanitizeInput(quizTitle);
    const safeTeacherName = this._sanitizeInput(teacherName);
    const safeLink = this._sanitizeInput(uniqueLink);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f6f9fc;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .content {
      padding: 40px 30px;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      margin: 20px 0;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(102, 126, 234, 0.3);
    }
    .info-box {
      background: #f8f9ff;
      padding: 20px;
      border-left: 4px solid #667eea;
      margin: 20px 0;
      border-radius: 6px;
    }
    .instructions {
      background: #fff9e6;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
    }
    .footer {
      text-align: center;
      padding: 30px;
      background: #f8f9fa;
      color: #666;
      font-size: 14px;
    }
    .link-box {
      background: white;
      border: 1px solid #e1e5e9;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
      word-break: break-all;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    @media (max-width: 600px) {
      .container {
        margin: 10px;
        border-radius: 8px;
      }
      .content {
        padding: 30px 20px;
      }
      .header {
        padding: 30px 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📝 Quiz Invitation</h1>
    </div>
    <div class="content">
      <h2>Hello!</h2>
      <p>You have been invited by <strong>${safeTeacherName}</strong> to attempt a quiz:</p>
      
      <div class="info-box">
        <h3 style="margin: 0 0 10px 0;">${safeQuizTitle}</h3>
        <p style="margin: 0; color: #666;">Click the button below to access your personalized quiz link.</p>
      </div>

      <div style="text-align: center;">
        <a href="${safeLink}" class="button" target="_blank" rel="noopener noreferrer">
          Start Quiz Now
        </a>
      </div>

      <div class="instructions">
        <h4 style="margin-top: 0;">📋 Important Instructions:</h4>
        <ul>
          <li>This link is unique to you and should not be shared</li>
          <li>You'll need to enter your student details before starting</li>
          <li>Complete the quiz within the allocated time</li>
          <li>Ensure you have a stable internet connection</li>
          <li>Do not refresh or close the browser during the quiz</li>
        </ul>
      </div>

      <div class="link-box">
        <p style="margin: 0; font-family: monospace; font-size: 14px;">
          <strong>Direct Link:</strong><br>
          <a href="${safeLink}">${safeLink}</a>
        </p>
      </div>

      <p>Good luck with your quiz! 🎓</p>
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply to this message.</p>
      <p>If you have any questions, please contact your instructor directly.</p>
    </div>
  </div>
</body>
</html>`;
  }

  async _rateLimit() {
    const now = Date.now();
    const timeSinceLastCall = now - this.rateLimit.lastCall;
    
    if (timeSinceLastCall < this.rateLimit.minInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimit.minInterval - timeSinceLastCall)
      );
    }
    
    this.rateLimit.lastCall = Date.now();
  }

  async _sendViaBrevo(studentEmail, quizTitle, uniqueLink, teacherName) {
    if (!this.brevoApiKey) {
      throw new Error('BREVO_API_KEY not configured');
    }

    if (!this._validateEmail(studentEmail)) {
      throw new Error(`Invalid student email: ${studentEmail}`);
    }

    const htmlContent = this._buildHtml(quizTitle, uniqueLink, teacherName);
    const senderName = teacherName || this.defaultFromName || 'Quiz System';

    const payload = {
      sender: {
        name: senderName,
        email: this.defaultFromEmail
      },
      to: [{
        email: studentEmail,
        name: studentEmail.split('@')[0] // Use username as display name
      }],
      subject: `Quiz Invitation: ${quizTitle}`,
      htmlContent,
      tags: ['quiz-invitation'],
      headers: {
        'X-Mailer': 'Quiz-System/1.0'
      }
    };

    try {
      const response = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: {
          'api-key': this.brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000 // 15 second timeout
      });

      const data = response?.data || {};
      this.metrics.totalSent++;
      
      return {
        success: true,
        messageId: data.messageId,
        provider: 'brevo',
        raw: data
      };
    } catch (error) {
      this.metrics.failedAttempts++;
      
      const errorDetails = error.response?.data || error.message;
      console.error('Brevo API Error:', {
        email: studentEmail,
        error: errorDetails,
        status: error.response?.status
      });

      throw new Error(`Brevo API: ${JSON.stringify(errorDetails)}`);
    }
  }

  async _sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName) {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    if (!this._validateEmail(studentEmail)) {
      throw new Error(`Invalid student email: ${studentEmail}`);
    }

    const htmlContent = this._buildHtml(quizTitle, uniqueLink, teacherName);
    const senderName = teacherName || this.defaultFromName || 'Quiz System';

    const mailOptions = {
      from: `"${senderName}" <${this.defaultFromEmail}>`,
      to: studentEmail,
      subject: `Quiz Invitation: ${quizTitle}`,
      html: htmlContent,
      headers: {
        'X-Mailer': 'Quiz-System/1.0',
        'X-Auto-Response-Suppress': 'OOF, AutoReply'
      }
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.metrics.totalSent++;
      
      console.log(`SMTP Email sent to ${studentEmail}: ${info.messageId}`);
      
      return {
        success: true,
        messageId: info.messageId,
        provider: 'smtp',
        raw: info
      };
    } catch (error) {
      this.metrics.failedAttempts++;
      this.metrics.lastError = error.message;
      
      console.error(`SMTP Send Error to ${studentEmail}:`, error.message);
      throw new Error(`SMTP: ${error.message}`);
    }
  }

  async sendQuizInvitation(studentEmail, quizTitle, uniqueLink, teacherName) {
    // Input validation
    if (!studentEmail || !this._validateEmail(studentEmail)) {
      throw new Error('Valid studentEmail is required');
    }

    if (!quizTitle?.trim()) {
      throw new Error('quizTitle is required');
    }

    if (!uniqueLink?.trim()) {
      throw new Error('uniqueLink is required');
    }

    // Apply rate limiting
    await this._rateLimit();

    const startTime = Date.now();
    let result;

    try {
      // Try Brevo first if available
      if (this.brevoApiKey) {
        try {
          result = await this._sendViaBrevo(studentEmail, quizTitle, uniqueLink, teacherName);
          return result;
        } catch (brevoError) {
          console.warn(`Brevo failed for ${studentEmail}, trying SMTP fallback:`, brevoError.message);
          
          if (this.useSmtpFallback && this.transporter) {
            result = await this._sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName);
            return result;
          }
          throw brevoError;
        }
      }

      // Try SMTP if Brevo not available
      if (this.useSmtpFallback && this.transporter) {
        result = await this._sendViaSmtp(studentEmail, quizTitle, uniqueLink, teacherName);
        return result;
      }

      throw new Error('No email sending method configured');

    } finally {
      const duration = Date.now() - startTime;
      console.log(`Email send attempt completed in ${duration}ms for ${studentEmail}`);
    }
  }

  async sendBulkInvitations(emails, quizTitle, uniqueLink, teacherName) {
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new Error('Emails array is required and cannot be empty');
    }

    const results = {
      successful: [],
      failed: [],
      total: emails.length
    };

    // Process emails in batches to avoid overwhelming the email service
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchPromises = batch.map(email => 
        this.sendQuizInvitation(email, quizTitle, uniqueLink, teacherName)
          .then(result => ({ email, success: true, result }))
          .catch(error => ({ email, success: false, error: error.message }))
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const { email, success, result: res, error } = result.value;
          if (success) {
            results.successful.push({ email, result: res });
          } else {
            results.failed.push({ email, error });
          }
        } else {
          results.failed.push({ email: 'unknown', error: result.reason });
        }
      });

      // Small delay between batches
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  async verifyConnection() {
    const results = {
      brevo: false,
      smtp: false,
      errors: []
    };

    // Test Brevo connection
    if (this.brevoApiKey) {
      try {
        const response = await axios.get('https://api.brevo.com/v3/account', {
          headers: {
            'api-key': this.brevoApiKey,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        if (response.status === 200) {
          results.brevo = true;
          console.log('Brevo API: Connection verified');
        } else {
          results.errors.push(`Brevo API returned status: ${response.status}`);
        }
      } catch (error) {
        const errorMsg = error.response?.data || error.message;
        results.errors.push(`Brevo API: ${errorMsg}`);
        console.error('Brevo connection test failed:', errorMsg);
      }
    }

    // Test SMTP connection
    if (this.transporter) {
      try {
        await this.transporter.verify();
        results.smtp = true;
        console.log('SMTP: Connection verified');
      } catch (error) {
        results.errors.push(`SMTP: ${error.message}`);
        console.error('SMTP connection test failed:', error.message);
      }
    }

    if (!results.brevo && !results.smtp) {
      results.errors.push('No email providers configured');
    }

    return results;
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  // Graceful shutdown
  async close() {
    if (this.transporter) {
      this.transporter.close();
      console.log('SMTP transporter closed');
    }
  }
}

// Create singleton instance
const emailService = new EmailService();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing email service...');
  await emailService.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing email service...');
  await emailService.close();
  process.exit(0);
});

module.exports = emailService;