import {
	Body,
	Button,
	Column,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Preview,
	Row,
	Section,
	Tailwind,
	Text,
} from "@react-email/components";
import { brand } from "@paas/branding";
import { emailTailwindConfig } from "../tailwind-config";

export type TemplateProps = {
	userName: string;
	planName: string;
	daysRemaining: number;
	endsOn: string;
	billingUrl: string;
};

export const TrialExpiringEmail = ({
	userName = "User",
	planName = "Starter",
	daysRemaining = 3,
	endsOn = "2024-01-01",
	billingUrl = "https://hatdot.cloud/dashboard/settings/billing",
}: TemplateProps) => {
	const dayLabel = daysRemaining === 1 ? "day" : "days";
	const previewText =
		daysRemaining === 1
			? `Your ${brand.APP_NAME} trial ends tomorrow`
			: `Your ${brand.APP_NAME} trial ends in ${daysRemaining} ${dayLabel}`;

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Body className="bg-[#f4f4f5] my-auto mx-auto font-sans">
					<Container className="my-[40px] mx-auto max-w-[520px]">
						{/* Header */}
						<Section className="bg-[#09090b] rounded-t-xl px-[40px] py-[32px] text-center">
							<div
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "10px",
									justifyContent: "center",
								}}
							>
								<div
									style={{
										width: "28px",
										height: "28px",
										borderRadius: "8px",
										background: "#3b82f6",
										display: "inline-block",
										verticalAlign: "middle",
									}}
								/>
								<span
									style={{
										color: "#ffffff",
										fontSize: "20px",
										fontWeight: 700,
										letterSpacing: "-0.5px",
										verticalAlign: "middle",
									}}
								>
									{brand.APP_NAME}
								</span>
							</div>
						</Section>

						<Section className="bg-white px-[40px] py-[32px]">
							<Heading className="text-[#09090b] text-[22px] font-semibold m-0 mb-[8px]">
								{daysRemaining === 1
									? "Your trial ends tomorrow"
									: `Your trial ends in ${daysRemaining} ${dayLabel}`}
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								Hello {userName}, activate your subscription to keep your
								applications and databases running smoothly once the trial ends.
							</Text>

							<Section className="border border-solid border-[#e4e4e7] rounded-lg overflow-hidden mb-[24px]">
								<Row className="bg-[#fafafa]">
									<Column className="px-[20px] py-[14px] w-[50%]">
										<Text className="text-[#71717a] text-[12px] font-medium uppercase tracking-wider m-0">
											Plan
										</Text>
										<Text className="text-[#09090b] text-[14px] font-semibold m-0 mt-[4px]">
											{planName}
										</Text>
									</Column>
									<Column className="px-[20px] py-[14px] w-[50%]">
										<Text className="text-[#71717a] text-[12px] font-medium uppercase tracking-wider m-0">
											Trial ends
										</Text>
										<Text className="text-[#09090b] text-[14px] font-semibold m-0 mt-[4px]">
											{endsOn}
										</Text>
									</Column>
								</Row>
							</Section>

							<Section className="bg-[#fefce8] border border-solid border-[#fef08a] rounded-lg px-[20px] py-[16px] mb-[24px]">
								<Text className="text-[#854d0e] text-[13px] leading-[20px] m-0">
									Without an active subscription, services will pause when the trial concludes.
									You can choose any plan to continue seamlessly.
								</Text>
							</Section>

							<Section className="text-center mb-[24px]">
								<Button
									href={billingUrl}
									className="bg-[#09090b] rounded-lg text-white text-[14px] font-semibold no-underline text-center px-[24px] py-[12px]"
								>
									Activate Subscription
								</Button>
							</Section>

							<Hr className="border-[#e4e4e7] my-[24px]" />

							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								You have full control over your billing and can upgrade or modify your plan at any time.
							</Text>
						</Section>

						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								This is an automated notification from{" "}
								<Link
									href={brand.MARKETING_URL}
									className="text-[#71717a] underline font-medium"
								>
									{brand.APP_NAME}
								</Link>
								. If you have questions about your account, contact{" "}
								<Link
									href={`mailto:${brand.SUPPORT_EMAIL}`}
									className="text-[#71717a] underline font-medium"
								>
									{brand.SUPPORT_EMAIL}
								</Link>
								.
							</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
};

export default TrialExpiringEmail;
