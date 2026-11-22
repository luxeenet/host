import { render } from "@react-email/components";
import { brand } from "@paas/branding";
import InvitationEmail from "../emails/emails/invitation";
import VerifyEmailTemplate from "../emails/emails/verify-email";
import { sendPlatformMail } from "../services/smtp-settings";

export const getStaticVerificationHtml = ({
	userName,
	verificationUrl,
}: {
	userName: string;
	verificationUrl: string;
}) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #09090b; padding: 32px 40px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">${brand.APP_NAME}</h1>
      <p style="color: #a1a1aa; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0 0 0;">Developer Cloud Platform</p>
    </div>
    <div style="padding: 40px 40px 32px;">
      <h2 style="color: #09090b; font-size: 22px; font-weight: 600; margin: 0 0 12px;">Verify Your Email Address</h2>
      <p style="color: #71717a; font-size: 14px; line-height: 24px; margin: 0 0 28px;">
        Hello ${userName || "there"}, thank you for signing up for ${brand.APP_NAME}. Please verify your email address to activate your cloud account and start deploying.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${verificationUrl}" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25);">Verify Email Address</a>
      </div>
      <p style="color: #a1a1aa; font-size: 13px; line-height: 20px; margin: 0 0 8px; text-align: center;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="color: #71717a; font-size: 12px; line-height: 18px; margin: 0; word-break: break-all; text-align: center;">
        <a href="${verificationUrl}" style="color: #0284c7; text-decoration: underline;">${verificationUrl}</a>
      </p>
    </div>
    <div style="background-color: #fafafa; padding: 20px 40px; text-align: center; border-top: 1px solid #e4e4e7;">
      <p style="color: #a1a1aa; font-size: 12px; line-height: 18px; margin: 0;">
        This is an automated security email from <a href="${brand.MARKETING_URL}" style="color: #71717a; text-decoration: underline;">${brand.APP_NAME}</a>.
      </p>
      <p style="color: #a1a1aa; font-size: 11px; line-height: 16px; margin: 8px 0 0 0;">
        ${brand.COPYRIGHT}
      </p>
    </div>
  </div>
</body>
</html>`;

export const getStaticInvitationHtml = ({
	email,
	inviteLink,
	organizationName,
}: {
	email: string;
	inviteLink: string;
	organizationName: string;
}) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #09090b; padding: 32px 40px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">${brand.APP_NAME}</h1>
      <p style="color: #a1a1aa; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0 0 0;">Team Workspace Invitation</p>
    </div>
    <div style="padding: 40px 40px 32px;">
      <h2 style="color: #09090b; font-size: 22px; font-weight: 600; margin: 0 0 12px;">Join ${organizationName}</h2>
      <p style="color: #71717a; font-size: 14px; line-height: 24px; margin: 0 0 28px;">
        You have been invited to join <strong>${organizationName}</strong> on ${brand.APP_NAME}. Click the button below to accept and get started.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${inviteLink}" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">Accept Invitation</a>
      </div>
      <p style="color: #a1a1aa; font-size: 13px; line-height: 20px; margin: 0 0 8px; text-align: center;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="color: #71717a; font-size: 12px; line-height: 18px; margin: 0; word-break: break-all; text-align: center;">
        <a href="${inviteLink}" style="color: #0284c7; text-decoration: underline;">${inviteLink}</a>
      </p>
    </div>
    <div style="background-color: #fafafa; padding: 20px 40px; text-align: center; border-top: 1px solid #e4e4e7;">
      <p style="color: #a1a1aa; font-size: 12px; line-height: 18px; margin: 0;">
        This invitation was intended for ${email}. Sent from <a href="${brand.MARKETING_URL}" style="color: #71717a; text-decoration: underline;">${brand.APP_NAME} Cloud</a>.
      </p>
      <p style="color: #a1a1aa; font-size: 11px; line-height: 16px; margin: 8px 0 0 0;">
        ${brand.COPYRIGHT}
      </p>
    </div>
  </div>
</body>
</html>`;

export const sendEmail = async ({
	email,
	subject,
	text,
	html,
	attachments,
}: {
	email: string;
	subject: string;
	text?: string;
	html?: string;
	attachments?: { filename: string; content: Buffer }[];
}) => {
	// If only text is provided and it looks like HTML, use it as html
	const htmlContent = html || (text && text.includes("<") ? text : undefined);
	const textContent = text && !text.includes("<") ? text : undefined;

	try {
		return await sendPlatformMail({
			to: email,
			subject,
			html: htmlContent,
			text: textContent,
			attachments,
		});
	} catch (err) {
		console.error(`[email] Delivery failed for ${email}:`, err);
		return false;
	}
};

export const sendVerificationEmail = async ({
	userName,
	email,
	verificationUrl,
}: {
	userName: string;
	email: string;
	verificationUrl: string;
}) => {
	let html: string;
	try {
		html = await render(
			VerifyEmailTemplate({
				userName: userName || "User",
				verificationUrl,
			}),
		);
	} catch (err) {
		console.warn(`[email] VerifyEmailTemplate render failed, using robust static fallback:`, err);
		html = getStaticVerificationHtml({
			userName: userName || "User",
			verificationUrl,
		});
	}

	return await sendEmail({
		email,
		subject: `Verify your email — ${brand.APP_NAME}`,
		html,
		text: `Hello ${userName || "there"}, please verify your ${brand.APP_NAME} account by visiting: ${verificationUrl}`,
	});
};

export const renderInvitationEmail = async ({
	email,
	inviteLink,
	organizationName,
}: {
	email: string;
	inviteLink: string;
	organizationName: string;
}) => {
	try {
		return await render(
			InvitationEmail({
				inviteLink,
				toEmail: email,
				organizationName,
			}),
		);
	} catch (err) {
		console.warn(`[email] renderInvitationEmail failed, using robust static fallback:`, err);
		return getStaticInvitationHtml({
			email,
			inviteLink,
			organizationName,
		});
	}
};

export const sendInvitationEmail = async ({
	email,
	inviteLink,
	organizationName,
}: {
	email: string;
	inviteLink: string;
	organizationName: string;
}) => {
	const html = await renderInvitationEmail({
		email,
		inviteLink,
		organizationName,
	});
	return await sendEmail({
		email,
		subject: `You've been invited to join ${organizationName} on ${brand.APP_NAME}`,
		html,
		text: `You have been invited to join ${organizationName} on ${brand.APP_NAME}. Accept your invitation here: ${inviteLink}`,
	});
};
