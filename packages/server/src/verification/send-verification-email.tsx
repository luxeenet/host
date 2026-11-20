import { render } from "@react-email/components";
import { brand } from "@paas/branding";
import InvitationEmail from "../emails/emails/invitation";
import VerifyEmailTemplate from "../emails/emails/verify-email";
import { sendPlatformMail } from "../services/smtp-settings";

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
	const html = await render(
		VerifyEmailTemplate({
			userName: userName || "User",
			verificationUrl,
		}),
	);
	await sendEmail({
		email,
		subject: `Verify your email — ${brand.APP_NAME}`,
		html,
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
	return render(
		InvitationEmail({
			inviteLink,
			toEmail: email,
			organizationName,
		}),
	);
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
	await sendEmail({
		email,
		subject: `You've been invited to join ${organizationName} on ${brand.APP_NAME}`,
		html,
	});
};
