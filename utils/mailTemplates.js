// Gmail (and most corporate filters) score a message that is little more than a
// bare URL on a text-only body as spam, which is why activation mails that were
// accepted by the SMTP server never reached the inbox. Every transactional mail
// therefore ships an HTML part with a real layout plus a plain text alternative
// for clients that cannot render it.

const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const layout = ({ heading, intro, ctaLabel, ctaUrl, footnote, fallback }) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:#2563eb;padding:24px 32px;">
                <span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;border-radius:12px;background-color:#ffffff;color:#2563eb;font-size:20px;font-weight:700;">S</span>
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.01em;vertical-align:middle;margin-left:12px;">Shop Management</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${escapeHtml(heading)}</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${intro}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:12px;background-color:#2563eb;">
                      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b;">If the button does not work, paste this link into your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${escapeHtml(ctaUrl)}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(ctaUrl)}</a></p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${footnote}</p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${escapeHtml(fallback)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

// The link travels in the email only; nothing in the HTML body depends on the
// recipient name being present, so a shop without a name still renders.
const shopActivationTemplate = ({ shopName, activationUrl, expiresIn = "24 hours" }) => {
  const name = String(shopName || "").trim();
  // Two forms of the same greeting: the text part is plain text and must not be
  // escaped, the HTML part is injected into markup and must be.
  const plainGreeting = name ? `Hello ${name},` : "Hello,";
  const htmlGreeting = name ? `Hello ${escapeHtml(name)},` : "Hello,";

  return {
    subject: "Activate your shop",
    text: `${plainGreeting}\n\nPlease activate your shop by opening the link below:\n\n${activationUrl}\n\nThe link expires in ${expiresIn}. If you did not register this shop, you can ignore this email.`,
    html: layout({
      heading: "Activate your shop",
      intro: `${htmlGreeting} please confirm this email address to activate your shop and start selling.`,
      ctaLabel: "Activate my shop",
      ctaUrl: activationUrl,
      footnote: `This link expires in ${escapeHtml(expiresIn)} and can only be used once. If you did not create this shop, you can safely ignore this email.`,
      fallback: "You are receiving this because a shop was registered with this email address.",
    }),
  };
};

const userActivationTemplate = ({ userName, activationUrl, expiresIn = "24 hours" }) => {
  const name = String(userName || "").trim();
  const plainGreeting = name ? `Hello ${name},` : "Hello,";
  const htmlGreeting = name ? `Hello ${escapeHtml(name)},` : "Hello,";

  return {
    subject: "Activate your account",
    text: `${plainGreeting}\n\nPlease click the link below to activate your account:\n\n${activationUrl}\n\nThe link expires in ${expiresIn}. If you did not sign up, you can ignore this email.`,
    html: layout({
      heading: "Activate your account",
      intro: `${htmlGreeting} please confirm this email address to activate your account.`,
      ctaLabel: "Activate my account",
      ctaUrl: activationUrl,
      footnote: `This link expires in ${escapeHtml(expiresIn)} and can only be used once. If you did not sign up, you can safely ignore this email.`,
      fallback: "You are receiving this because an account was registered with this email address.",
    }),
  };
};

module.exports = { shopActivationTemplate, userActivationTemplate };
