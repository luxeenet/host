import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Link,
	Preview,
	Section,
	Tailwind,
	Text,
} from "@react-email/components";
import { brand } from "@paas/branding";
import { emailTailwindConfig } from "../tailwind-config";

export type TemplateProps = {
	userName: string;
	verificationUrl: string;
};

export const VerifyEmailTemplate = ({
	userName = "User",
	verificationUrl = `https://console.${brand.PLATFORM_SUBDOMAIN_BASE}/verify`,
}: TemplateProps) => {
	const previewText = `Verify your email address to get started with ${brand.APP_NAME}`;
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
								Developer Cloud Platform
							</Text>
						</Section>

						{/* Body */}
						<Section className="bg-white px-[40px] py-[32px]">
							<Heading className="text-[#09090b] text-[22px] font-semibold m-0 mb-[8px]">
								Verify Your Email Address
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								Hello {userName}, thank you for signing up for {brand.APP_NAME}. Please
								verify your email address to activate your cloud account and start deploying.
							</Text>

							{/* CTA Button */}
							<Section className="text-center mb-[24px]">
								<Button
									href={verificationUrl}
									className="bg-[#0284c7] hover:bg-[#0369a1] rounded-lg text-white text-[14px] font-semibold no-underline text-center px-[28px] py-[13px] shadow-sm"
								>
									Verify Email Address
								</Button>
							</Section>

							<Text className="text-[#a1a1aa] text-[13px] leading-[20px] m-0 text-center mb-[16px]">
								If the button above doesn't work, copy and paste the following
								link into your browser:
							</Text>
							<Text className="text-[#71717a] text-[12px] leading-[18px] m-0 text-center break-all">
								{verificationUrl}
							</Text>
						</Section>

						{/* Footer */}
						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								This is an automated email from{" "}
								<Link
									href={brand.MARKETING_URL}
									className="text-[#71717a] underline"
								>
									{brand.APP_NAME} Cloud
								</Link>
								. If you didn't create an account, you can safely ignore this email.
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

export default VerifyEmailTemplate;
