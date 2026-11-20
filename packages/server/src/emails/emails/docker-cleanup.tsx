import {
	Body,
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
	message: string;
	date: string;
};

export const DockerCleanupEmail = ({
	message = "System cache maintenance completed",
	date = "2024-01-01T00:00:00.000Z",
}: TemplateProps) => {
	const previewText = `System maintenance completed on ${brand.APP_NAME}`;
	return (
		<Html>
			<Preview>{previewText}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Head />
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

						{/* Body */}
						<Section className="bg-white px-[40px] py-[32px]">
							<Heading className="text-[#09090b] text-[22px] font-semibold m-0 mb-[8px]">
								System Maintenance Cleaned
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								Scheduled storage maintenance and unused cache pruning was successfully executed.
							</Text>

							<Section className="border border-solid border-[#e4e4e7] rounded-lg p-[16px] bg-[#fafafa]">
								<Text className="text-[#71717a] text-[12px] font-medium uppercase tracking-wider m-0 mb-[8px]">
									Details
								</Text>
								<Text className="text-[#09090b] text-[13px] leading-[20px] m-0">
									Summary: <strong>{message}</strong>
								</Text>
								<Text className="text-[#09090b] text-[13px] leading-[20px] m-0">
									Date: <strong>{date}</strong>
								</Text>
							</Section>
						</Section>

						{/* Footer */}
						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								This is an automated operational notification from{" "}
								<Link
									href={brand.MARKETING_URL}
									className="text-[#71717a] underline font-medium"
								>
									{brand.APP_NAME}
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

export default DockerCleanupEmail;
