const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
  } else {
    // Fallback to ethereal test account (for development)
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: 'test@ethereal.email', pass: 'test' } // dummy, will be replaced on real deploy
    });
  }
  return transporter;
}

async function sendDealReadyEmail(deal, buyerEmail, sellerEmail) {
  const transporter = getTransporter();
  const adminEmail = process.env.ADMIN_EMAIL || 'info@abandonedassets.com';
  const subject = `Deal ready to close: ${deal.address}, ${deal.city}, ${deal.state}`;
  const text = `
    A deal is ready for closing.
    
    Property: ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
    Price: $${deal.price}
    Buyer: ${buyerEmail}
    Seller: ${sellerEmail}
    
    Please log in to finalize.
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@abandonedassets.com',
    to: adminEmail,
    subject,
    text
  });
}

module.exports = { sendDealReadyEmail };
