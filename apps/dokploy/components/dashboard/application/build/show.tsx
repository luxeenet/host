import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import {
	Box,
	ChevronDown,
	ChevronRight,
	Cog,
	FileCode,
	Layers,
	Settings2,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

export const RAILPACK_VERSIONS = [
	"0.39.0",
	"0.38.0",
	"0.37.1",
	"0.37.0",
	"0.36.4",
	"0.36.3",
	"0.36.2",
	"0.36.1",
	"0.36.0",
	"0.35.0",
	"0.34.0",
	"0.33.0",
	"0.32.0",
	"0.31.2",
	"0.31.1",
	"0.31.0",
	"0.30.1",
	"0.30.0",
	"0.29.0",
	"0.28.0",
	"0.27.2",
	"0.27.1",
	"0.27.0",
	"0.26.1",
	"0.26.0",
	"0.25.0",
	"0.24.0",
	"0.23.0",
	"0.22.2",
	"0.22.1",
	"0.22.0",
	"0.21.0",
	"0.20.0",
	"0.19.0",
	"0.18.0",
	"0.17.2",
	"0.17.1",
	"0.17.0",
	"0.16.0",
	"0.15.4",
	"0.15.3",
	"0.15.2",
	"0.15.1",
	"0.15.0",
	"0.14.0",
	"0.13.0",
	"0.12.0",
	"0.11.0",
	"0.10.0",
	"0.9.2",
	"0.9.1",
	"0.9.0",
	"0.8.0",
	"0.7.2",
	"0.7.1",
	"0.7.0",
	"0.6.1",
	"0.6.0",
	"0.5.1",
	"0.5.0",
	"0.4.0",
	"0.3.0",
	"0.2.3",
	"0.2.2",
	"0.2.1",
	"0.2.0",
	"0.1.2",
	"0.1.1",
	"0.1.0",
] as const;

export enum BuildType {
	dockerfile = "dockerfile",
	heroku_buildpacks = "heroku_buildpacks",
	paketo_buildpacks = "paketo_buildpacks",
	nixpacks = "nixpacks",
	static = "static",
	railpack = "railpack",
}

const mySchema = z.discriminatedUnion("buildType", [
	z.object({
		buildType: z.literal(BuildType.dockerfile),
		dockerfile: z.string().nullable().default(""),
		dockerContextPath: z.string().nullable().default(""),
		dockerBuildStage: z.string().nullable().default(""),
	}),
	z.object({
		buildType: z.literal(BuildType.heroku_buildpacks),
		herokuVersion: z.string().nullable().default(""),
	}),
	z.object({
		buildType: z.literal(BuildType.paketo_buildpacks),
	}),
	z.object({
		buildType: z.literal(BuildType.nixpacks),
		publishDirectory: z.string().optional(),
		isStaticSpa: z.boolean().default(false),
	}),
	z.object({
		buildType: z.literal(BuildType.railpack),
		railpackVersion: z.string().nullable().default("0.15.4"),
	}),
	z.object({
		buildType: z.literal(BuildType.static),
		isStaticSpa: z.boolean().default(false),
	}),
]);

type AddTemplate = z.infer<typeof mySchema>;

interface Props {
	applicationId: string;
}

interface ApplicationData {
	buildType: BuildType;
	dockerfile?: string | null;
	dockerContextPath?: string | null;
	dockerBuildStage?: string | null;
	herokuVersion?: string | null;
	publishDirectory?: string | null;
	isStaticSpa?: boolean | null;
	railpackVersion?: string | null | undefined;
}

function isValidBuildType(value: string): value is BuildType {
	return Object.values(BuildType).includes(value as BuildType);
}

const resetData = (data: ApplicationData): AddTemplate => {
	switch (data.buildType) {
		case BuildType.dockerfile:
			return {
				buildType: BuildType.dockerfile,
				dockerfile: data.dockerfile || "",
				dockerContextPath: data.dockerContextPath || "",
				dockerBuildStage: data.dockerBuildStage || "",
			};
		case BuildType.heroku_buildpacks:
			return {
				buildType: BuildType.heroku_buildpacks,
				herokuVersion: data.herokuVersion || "",
			};
		case BuildType.nixpacks:
			return {
				buildType: BuildType.nixpacks,
				publishDirectory: data.publishDirectory || undefined,
				isStaticSpa: data.isStaticSpa ?? false,
			};
		case BuildType.paketo_buildpacks:
			return {
				buildType: BuildType.paketo_buildpacks,
			};
		case BuildType.static:
			return {
				buildType: BuildType.static,
				isStaticSpa: data.isStaticSpa ?? false,
			};
		case BuildType.railpack:
			return {
				buildType: BuildType.railpack,
				railpackVersion: data.railpackVersion || null,
			};
		default: {
			const buildType = data.buildType as BuildType;
			return {
				buildType,
			} as AddTemplate;
		}
	}
};

export const ShowBuildChooseForm = ({ applicationId }: Props) => {
	const [showAdvanced, setShowAdvanced] = useState(false);
	const { mutateAsync, isPending } =
		api.application.saveBuildType.useMutation();
	const { data, refetch } = api.application.one.useQuery(
		{ applicationId },
		{ enabled: !!applicationId },
	);
	const { data: inspection } = api.application.inspectApp.useQuery(
		{ applicationId },
		{ enabled: !!applicationId, refetchOnWindowFocus: false },
	);

	const form = useForm({
		defaultValues: {
			buildType: BuildType.nixpacks,
		},
		resolver: zodResolver(mySchema),
	});

	const buildType = form.watch("buildType");
	const railpackVersion = form.watch("railpackVersion");
	const [isManualRailpackVersion, setIsManualRailpackVersion] = useState(false);

	useEffect(() => {
		if (data) {
			const typedData: ApplicationData = {
				...data,
				buildType: isValidBuildType(data.buildType)
					? (data.buildType as BuildType)
					: BuildType.nixpacks,
			};

			form.reset(resetData(typedData));

			if (
				data.railpackVersion &&
				!RAILPACK_VERSIONS.includes(data.railpackVersion as any)
			) {
				setIsManualRailpackVersion(true);
			}
		}
	}, [form, data]);

	const onSubmit = async (formData: AddTemplate) => {
		const payload = {
			applicationId,
			buildType: formData.buildType,
			dockerfile: "dockerfile" in formData ? formData.dockerfile : null,
			dockerContextPath:
				"dockerContextPath" in formData ? formData.dockerContextPath : null,
			dockerBuildStage:
				"dockerBuildStage" in formData ? formData.dockerBuildStage : null,
			herokuVersion:
				"herokuVersion" in formData ? formData.herokuVersion : null,
			publishDirectory:
				"publishDirectory" in formData ? formData.publishDirectory : undefined,
			isStaticSpa: "isStaticSpa" in formData ? formData.isStaticSpa : false,
			railpackVersion:
				"railpackVersion" in formData ? formData.railpackVersion : null,
		};

		await mutateAsync(payload)
			.then(async () => {
				toast.success("Build settings saved successfully");
				refetch();
			})
			.catch(() => {
				toast.error("Error updating build settings");
			});
	};

	const isStandardBuilder =
		buildType === BuildType.nixpacks ||
		buildType === BuildType.dockerfile ||
		buildType === BuildType.static;

	return (
		<Card className="bg-background">
			<CardHeader>
				<CardTitle className="text-xl flex items-center justify-between">
					<span>Build Configuration</span>
					{inspection?.detected && (
						<Badge
							variant="outline"
							className="bg-primary/10 text-primary border-primary/20 flex items-center gap-1.5 font-normal text-xs"
						>
							<Sparkles className="size-3.5" />
							Detected: {inspection.detected.framework} (Port:{" "}
							{inspection.detected.suggestedPort})
						</Badge>
					)}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-6"
					>
						{/* Main Build Options */}
						<FormField
							control={form.control}
							name="buildType"
							render={({ field }) => (
								<FormItem className="space-y-3">
									<FormLabel className="text-sm font-semibold">
										How should HatDot build this application?
									</FormLabel>
									<FormControl>
										<RadioGroup
											onValueChange={field.onChange}
											value={field.value}
											className="grid grid-cols-1 md:grid-cols-3 gap-3"
										>
											{/* Recommended / Nixpacks */}
											<FormItem>
												<FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
													<FormControl>
														<RadioGroupItem
															value={BuildType.nixpacks}
															className="sr-only"
														/>
													</FormControl>
													<div className="p-4 rounded-lg border flex flex-col gap-2 transition-all">
														<div className="flex items-center justify-between">
															<span className="font-semibold text-sm flex items-center gap-1.5">
																<Sparkles className="size-4 text-primary" />
																Recommended
															</span>
															<Badge variant="secondary" className="text-[10px]">
																Auto-detect
															</Badge>
														</div>
														<p className="text-xs text-muted-foreground">
															Automatically detects Next.js, Vite, Python, Go,
															Node, etc. and builds with zero configuration.
														</p>
													</div>
												</FormLabel>
											</FormItem>

											{/* Dockerfile */}
											<FormItem>
												<FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
													<FormControl>
														<RadioGroupItem
															value={BuildType.dockerfile}
															className="sr-only"
														/>
													</FormControl>
													<div className="p-4 rounded-lg border flex flex-col gap-2 transition-all">
														<div className="flex items-center justify-between">
															<span className="font-semibold text-sm flex items-center gap-1.5">
																<FileCode className="size-4 text-primary" />
																Dockerfile
															</span>
														</div>
														<p className="text-xs text-muted-foreground">
															Uses the custom Dockerfile included in your
															project repository.
														</p>
													</div>
												</FormLabel>
											</FormItem>

											{/* Static */}
											<FormItem>
												<FormLabel className="[&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5 cursor-pointer">
													<FormControl>
														<RadioGroupItem
															value={BuildType.static}
															className="sr-only"
														/>
													</FormControl>
													<div className="p-4 rounded-lg border flex flex-col gap-2 transition-all">
														<div className="flex items-center justify-between">
															<span className="font-semibold text-sm flex items-center gap-1.5">
																<Layers className="size-4 text-primary" />
																Static Site
															</span>
														</div>
														<p className="text-xs text-muted-foreground">
															Serve pre-built HTML, CSS, client-side React/Vue,
															or Single Page Apps via Nginx.
														</p>
													</div>
												</FormLabel>
											</FormItem>
										</RadioGroup>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Dockerfile specific fields */}
						{buildType === BuildType.dockerfile && (
							<div className="p-4 rounded-lg border bg-muted/20 grid grid-cols-1 md:grid-cols-2 gap-4">
								<FormField
									control={form.control}
									name="dockerfile"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Dockerfile Path</FormLabel>
											<FormDescription className="text-xs">
												Relative path to Dockerfile (leave empty for
												"./Dockerfile")
											</FormDescription>
											<FormControl>
												<Input
													placeholder="./Dockerfile"
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="dockerContextPath"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Docker Context Path</FormLabel>
											<FormDescription className="text-xs">
												Build context directory (leave empty for root)
											</FormDescription>
											<FormControl>
												<Input
													placeholder="."
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="dockerBuildStage"
									render={({ field }) => (
										<FormItem className="col-span-full">
											<FormLabel>Build Stage (Target)</FormLabel>
											<FormDescription className="text-xs">
												Specific multi-stage target to build (optional)
											</FormDescription>
											<FormControl>
												<Input
													placeholder="runner or production"
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						)}

						{/* Static Site specific fields */}
						{buildType === BuildType.static && (
							<div className="p-4 rounded-lg border bg-muted/20">
								<FormField
									control={form.control}
									name="isStaticSpa"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between">
											<div className="space-y-0.5">
												<FormLabel className="text-sm">
													Single Page Application (SPA) Routing
												</FormLabel>
												<FormDescription className="text-xs">
													Redirect all 404 requests to index.html for client-side
													routers (React Router, Vue Router).
												</FormDescription>
											</div>
											<FormControl>
												<Checkbox
													checked={field.value}
													onCheckedChange={field.onChange}
												/>
											</FormControl>
										</FormItem>
									)}
								/>
							</div>
						)}

						{/* Advanced Builders & Settings Collapsible */}
						<div className="pt-2 border-t">
							<button
								type="button"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1"
							>
								<span className="flex items-center gap-1.5">
									<Settings2 className="size-3.5" />
									Advanced Builders & Legacy Buildpacks
								</span>
								{showAdvanced ? (
									<ChevronDown className="size-4" />
								) : (
									<ChevronRight className="size-4" />
								)}
							</button>

							{showAdvanced && (
								<div className="mt-4 flex flex-col gap-4 pl-2 border-l-2 border-primary/20">
									<FormField
										control={form.control}
										name="buildType"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Alternative Builders</FormLabel>
												<Select
													onValueChange={field.onChange}
													value={field.value}
												>
													<FormControl>
														<SelectTrigger>
															<SelectValue placeholder="Select builder" />
														</SelectTrigger>
													</FormControl>
													<SelectContent>
														<SelectItem value={BuildType.nixpacks}>
															Nixpacks (Default Auto-detect)
														</SelectItem>
														<SelectItem value={BuildType.dockerfile}>
															Dockerfile
														</SelectItem>
														<SelectItem value={BuildType.static}>
															Static HTML / SPA
														</SelectItem>
														<SelectItem value={BuildType.railpack}>
															Railpack (Railway Builder)
														</SelectItem>
														<SelectItem value={BuildType.heroku_buildpacks}>
															Heroku Buildpacks
														</SelectItem>
														<SelectItem value={BuildType.paketo_buildpacks}>
															Paketo Cloud Native Buildpacks
														</SelectItem>
													</SelectContent>
												</Select>
												<FormMessage />
											</FormItem>
										)}
									/>

									{/* Railpack options */}
									{buildType === BuildType.railpack && (
										<div className="p-3 bg-muted/30 rounded-lg flex flex-col gap-2">
											<FormField
												control={form.control}
												name="railpackVersion"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Railpack Version</FormLabel>
														<FormControl>
															<Select
																onValueChange={field.onChange}
																value={field.value || "0.15.4"}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Select version" />
																</SelectTrigger>
																<SelectContent>
																	{RAILPACK_VERSIONS.map((ver) => (
																		<SelectItem key={ver} value={ver}>
																			{ver}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
									)}

									{/* Nixpacks publish directory */}
									{buildType === BuildType.nixpacks && (
										<FormField
											control={form.control}
											name="publishDirectory"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Publish Directory (Optional)</FormLabel>
													<FormDescription className="text-xs">
														Directory containing output artifacts to serve
														(e.g. dist, out, build)
													</FormDescription>
													<FormControl>
														<Input
															placeholder="dist"
															{...field}
															value={field.value || ""}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}
								</div>
							)}
						</div>

						<div className="flex justify-end">
							<Button type="submit" isLoading={isPending}>
								Save Build Configuration
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
};
