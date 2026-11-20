import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Preview,
	Section,
	Tailwind,
	Text,
} from "@react-email/components";
import { brand } from "@paas/branding";
import { emailTailwindConfig } from "../tailwind-config";

interface InvitationEmailProps {
	inviteLink: string;
	toEmail: string;
	organizationName: string;
}

export const InvitationEmail = ({
	inviteLink,
	toEmail,
	organizationName = "an organization",
}: InvitationEmailProps) => {
	const previewText = `You've been invited to join ${organizationName} on ${brand.APP_NAME}`;
	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Body className="bg-[#f4f4f5] my-auto mx-auto font-sans">
					<Container className="my-[40px] mx-auto max-w-[520px]">
						{/* Header */}
						<Section className="bg-[#09090b] rounded-t-xl px-[40px] py-[28px] text-center">
							<Heading className="text-white text-[24px] font-extrabold tracking-tight m-0">
								{brand.APP_NAME}
							</Heading>
							<Text className="text-[#a1a1aa] text-[11px] font-semibold tracking-widest uppercase m-0 mt-[4px]">
								Team Workspace Invitation
							</Text>
						</Section>

						{/* Body */}
						<Section className="bg-white px-[40px] py-[32px]">
							<Heading className="text-[#09090b] text-[22px] font-semibold m-0 mb-[8px]">
								Join {organizationName}
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								You have been invited to join{" "}
								<strong className="text-[#09090b]">{organizationName}</strong>{" "}
								on {brand.APP_NAME}, the modern platform for deploying web applications,
								databases, and connected cloud stacks. Click below to accept and get started.
							</Text>

							{/* CTA Button */}
							<Section className="text-center mb-[24px]">
								<Button
									href={inviteLink}
									className="bg-[#0284c7] hover:bg-[#0369a1] rounded-lg text-white text-[14px] font-semibold no-underline text-center px-[28px] py-[13px] shadow-sm"
								>
									Accept Invitation
								</Button>
							</Section>

							<Text className="text-[#a1a1aa] text-[13px] leading-[20px] m-0 text-center mb-[16px]">
								If the button above doesn't work, copy and paste the following
								link into your browser:
							</Text>
							<Text className="text-[#71717a] text-[12px] leading-[18px] m-0 text-center break-all">
								{inviteLink}
							</Text>
						</Section>

						{/* Footer */}
						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Hr className="border border-solid border-[#e4e4e7] my-0 mb-[16px] mx-0 w-full" />
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								This invitation was intended for{" "}
								<span className="text-[#71717a]">{toEmail}</span>. Sent from{" "}
								<Link
									href={brand.MARKETING_URL}
									className="text-[#71717a] underline"
								>
									{brand.APP_NAME} Cloud
								</Link>
								. If you were not expecting this invitation, you can safely ignore this email.
							</Text>
							<Text className="text-[#a1a1aa] text-[11px] leading-[16px] m-0 mt-[8px]">
								{brand.COPYRIGHT}
							</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
};

export default InvitationEmail;
