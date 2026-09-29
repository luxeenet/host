import { cn } from "@/lib/utils";
import { brand } from "@paas/branding";

interface Props {
	className?: string;
	logoUrl?: string;
}

export const Logo = ({ className = "size-14", logoUrl }: Props) => {
	const src = logoUrl || brand.ICON_URL || "/logo-icon.png";

	return (
		<img
			src={src}
			alt={brand.APP_NAME}
			className={cn(className, "object-contain rounded-sm")}
		/>
	);
};
