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
	serverName: string;
	type: "CPU" | "Memory";
	value: string;
	threshold: string;
	message: string;
	date: string;
};

export const ServerThresholdEmail = ({
	serverName = "Node-01",
	type = "CPU",
	value = "95.00",
	threshold = "90.00",
	message = "Resource usage exceeded the configured threshold",
	date = "2024-01-01T00:00:00.000Z",
}: TemplateProps) => {
	const previewText = `Infrastructure ${type} warning: ${serverName} on ${brand.APP_NAME}`;
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
								Infrastructure Alert: {type} Usage
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								The {type} capacity for <strong>{serverName}</strong> has exceeded the configured threshold.
							</Text>

							<Section className="border border-solid border-[#e4e4e7] rounded-lg p-[16px] bg-[#fafafa] mb-[20px]">
								<Text className="text-[#71717a] text-[12px] font-medium uppercase tracking-wider m-0 mb-[8px]">
									Usage Metrics
								</Text>
								<Text className="text-[#09090b] text-[13px] leading-[20px] m-0">
									Host / Node: <strong>{serverName}</strong>
								</Text>
								<Text className="text-[#09090b] text-[13px] leading-[20px] m-0">
									Resource Type: <strong>{type}</strong>
								</Text>
								<Text className="text-[#dc2626] text-[13px] font-bold leading-[20px] m-0">
									Observed Value: {value}%
								</Text>
								<Text className="text-[#71717a] text-[13px] leading-[20px] m-0">
									Configured Alert Level: {threshold}%
								</Text>
								<Text className="text-[#09090b] text-[13px] leading-[20px] m-0">
									Timestamp: <strong>{date}</strong>
								</Text>
							</Section>

							<Section className="bg-[#fefce8] border border-solid border-[#fef08a] rounded-lg p-[16px]">
								<Text className="text-[#854d0e] text-[13px] leading-[20px] m-0">
									{message}
								</Text>
							</Section>
						</Section>

						{/* Footer */}
						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								This is an automated infrastructure alert from{" "}
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

export default ServerThresholdEmail;
