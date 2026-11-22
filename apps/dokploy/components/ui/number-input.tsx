import { useState, useEffect } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface UnitConverter {
	toValue: (raw: string | undefined) => number;
	fromValue: (value: number) => string;
	formatDisplay: (value: number) => string;
}

export const createConverter = (
	multiplier: number,
	formatDisplay: (value: number) => string,
): UnitConverter => ({
	toValue: (raw) => {
		if (!raw) return 0;
		const value = Number(raw);
		return Number.isNaN(value) ? 0 : value / multiplier;
	},
	fromValue: (value) =>
		value <= 0 ? "" : String(Math.round(value * multiplier)),
	formatDisplay,
});

export interface PresetOption {
	label: string;
	value: number;
}

interface NumberInputWithStepsProps {
	value: string | undefined;
	onChange: (value: string) => void;
	placeholder: string;
	step: number;
	converter: UnitConverter;
	presets?: PresetOption[];
	maxUnitValue?: number;
}

export const NumberInputWithSteps = ({
	value,
	onChange,
	placeholder,
	step,
	converter,
	presets,
	maxUnitValue,
}: NumberInputWithStepsProps) => {
	const numericValue = converter.toValue(value);
	const displayValue = converter.formatDisplay(numericValue);

	const [isFocused, setIsFocused] = useState(false);
	const [textInput, setTextInput] = useState("");

	useEffect(() => {
		if (!isFocused) {
			setTextInput(numericValue > 0 ? String(numericValue) : "");
		}
	}, [numericValue, isFocused]);

	const handleIncrement = () => {
		const next = numericValue + step;
		if (maxUnitValue && maxUnitValue > 0 && next > maxUnitValue) {
			onChange(converter.fromValue(maxUnitValue));
		} else {
			onChange(converter.fromValue(next));
		}
	};

	const handleDecrement = () => {
		onChange(converter.fromValue(Math.max(0, numericValue - step)));
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value;
		setTextInput(raw);
		const cleaned = raw.replace(/[^0-9.]/g, "");
		if (cleaned === "" || cleaned === ".") {
			onChange("");
			return;
		}
		const parsed = Number.parseFloat(cleaned);
		if (!Number.isNaN(parsed) && parsed >= 0) {
			if (maxUnitValue && maxUnitValue > 0 && parsed > maxUnitValue) {
				onChange(converter.fromValue(maxUnitValue));
			} else {
				onChange(converter.fromValue(parsed));
			}
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={handleDecrement}
					disabled={numericValue <= 0}
				>
					<MinusIcon className="h-4 w-4" />
				</Button>

				<div className="relative flex-1">
					<Input
						placeholder={placeholder}
						value={isFocused ? textInput : displayValue || ""}
						onFocus={() => {
							setIsFocused(true);
							setTextInput(numericValue > 0 ? String(numericValue) : "");
						}}
						onBlur={() => {
							setIsFocused(false);
						}}
						onChange={handleInputChange}
						className="text-center font-medium"
					/>
				</div>

				<Button
					type="button"
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={handleIncrement}
					disabled={Boolean(
						maxUnitValue && maxUnitValue > 0 && numericValue >= maxUnitValue,
					)}
				>
					<PlusIcon className="h-4 w-4" />
				</Button>
			</div>

			{/* Quick select presets */}
			{presets && presets.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 pt-0.5">
					<span className="text-[11px] text-muted-foreground mr-1">
						Presets:
					</span>
					{presets.map((p) => {
						const isSelected = Math.abs(numericValue - p.value) < 0.01;
						const isOverLimit = Boolean(
							maxUnitValue && maxUnitValue > 0 && p.value > maxUnitValue,
						);
						return (
							<button
								key={p.label}
								type="button"
								disabled={isOverLimit}
								onClick={() => onChange(converter.fromValue(p.value))}
								className={cn(
									"px-2 py-0.5 rounded text-xs transition-colors border",
									isSelected
										? "bg-primary text-primary-foreground border-primary font-medium"
										: "bg-muted/50 hover:bg-muted text-foreground border-border",
									isOverLimit &&
										"opacity-40 cursor-not-allowed hover:bg-muted/50",
								)}
								title={isOverLimit ? "Exceeds plan limit" : undefined}
							>
								{p.label}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
};
