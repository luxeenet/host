import {
	INVALID_HOSTNAME_MESSAGE,
	VALID_HOSTNAME_REGEX,
} from "@dokploy/server/utils/hostname-validation";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Copy,
	DatabaseZap,
	Dices,
	Globe,
	Loader2,
	RefreshCw,
	ShieldCheck,
	X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input, NumberInput } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { COMPOSE_REDEPLOY_TOAST, ComposeRedeployAlert } from "./redeploy-hint";

export type CacheType = "fetch" | "cache";

export const domain = z
	.object({
		host: z
			.string()
			.min(1, { message: "Add a hostname" })
			.refine((val) => val === val.trim(), {
				message: "Domain name cannot have leading or trailing spaces",
			})
			.transform((val) => val.trim())
			.refine((val) => VALID_HOSTNAME_REGEX.test(val), {
				message: INVALID_HOSTNAME_MESSAGE,
			}),
		path: z.string().min(1).optional(),
		internalPath: z.string().optional(),
		stripPath: z.boolean().optional(),
		port: z
			.number()
			.min(1, { message: "Port must be at least 1" })
			.max(65535, { message: "Port must be 65535 or below" })
			.optional(),
		useCustomEntrypoint: z.boolean(),
		customEntrypoint: z.string().optional(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
		customCertResolver: z.string().optional(),
		serviceName: z.string().optional(),
		domainType: z.enum(["application", "compose", "preview"]).optional(),
		middlewares: z.array(z.string()).optional(),
	})
	.superRefine((input, ctx) => {
		if (input.https && !input.certificateType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["certificateType"],
				message: "Required",
			});
		}

		if (input.certificateType === "custom" && !input.customCertResolver) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customCertResolver"],
				message: "Required",
			});
		}

		if (input.domainType === "compose" && !input.serviceName) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["serviceName"],
				message: "Required",
			});
		}

		// Validate stripPath requires a valid path
		if (input.stripPath && (!input.path || input.path === "/")) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stripPath"],
				message:
					"Strip path can only be enabled when a path other than '/' is specified",
			});
		}

		// Validate internalPath starts with /
		if (
			input.internalPath &&
			input.internalPath !== "/" &&
			!input.internalPath.startsWith("/")
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["internalPath"],
				message: "Internal path must start with '/'",
			});
		}

		if (input.useCustomEntrypoint && !input.customEntrypoint) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customEntrypoint"],
				message: "Custom entry point must be specified",
			});
		}
	});

type Domain = z.infer<typeof domain>;

interface Props {
	id: string;
	type: "application" | "compose";
	domainId?: string;
	children: React.ReactNode;
}

export const AddDomain = ({ id, type, domainId = "", children }: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [cacheType, setCacheType] = useState<CacheType>("cache");
	const [isManualInput, setIsManualInput] = useState(false);

	const utils = api.useUtils();
	const { data, refetch } = api.domain.one.useQuery(
		{
			domainId,
		},
		{
			enabled: isOpen && !!domainId,
		},
	);

	const { data: application } =
		type === "application"
			? api.application.one.useQuery(
					{
						applicationId: id,
					},
					{
						enabled: isOpen && !!id,
					},
				)
			: api.compose.one.useQuery(
					{
						composeId: id,
					},
					{
						enabled: isOpen && !!id,
					},
				);

	const { mutateAsync, isError, error, isPending } = domainId
		? api.domain.update.useMutation()
		: api.domain.create.useMutation();

	const { mutateAsync: generateDomain, isPending: isLoadingGenerate } =
		api.domain.generateDomain.useMutation();

	const { data: canGenerateTraefikMeDomains } =
		api.domain.canGenerateTraefikMeDomains.useQuery(
			{
				serverId: application?.serverId || "",
			},
			{
				enabled: isOpen,
			},
		);

	const {
		data: services,
		isFetching: isLoadingServices,
		error: errorServices,
		refetch: refetchServices,
	} = api.compose.loadServices.useQuery(
		{
			composeId: id,
			type: cacheType,
		},
		{
			retry: false,
			refetchOnWindowFocus: false,
			enabled: isOpen && type === "compose" && !!id,
		},
	);

	const form = useForm<Domain>({
		resolver: zodResolver(domain),
		defaultValues: {
			host: "",
			path: "/",
			internalPath: "/",
			stripPath: false,
			port: 3000,
			useCustomEntrypoint: false,
			customEntrypoint: undefined,
			https: true,
			certificateType: "letsencrypt",
			customCertResolver: undefined,
			serviceName: undefined,
			domainType: type,
			middlewares: [],
		},
		mode: "onChange",
	});

	const certificateType = form.watch("certificateType");
	const useCustomEntrypoint = form.watch("useCustomEntrypoint");
	const https = form.watch("https");
	const domainType = form.watch("domainType");
	const host = form.watch("host");
	const isTraefikMeDomain =
		host?.includes("sslip.io") || host?.includes("traefik.me") || false;

	// DNS instructions query for custom domains
	const isCustomDomain = !!host && !isTraefikMeDomain && host.includes(".");
	const {
		data: dnsInfo,
		isFetching: isCheckingDns,
		refetch: refetchDns,
	} = api.domain.dnsInstructions.useQuery(
		{
			host: host || "",
			serverId: application?.serverId || null,
		},
		{
			enabled: isOpen && isCustomDomain,
			refetchOnWindowFocus: false,
		},
	);

	useEffect(() => {
		if (data) {
			form.reset({
				...data,
				path: data?.path || "/",
				internalPath: data?.internalPath || "/",
				stripPath: data?.stripPath || false,
				port: data?.port || 3000,
				useCustomEntrypoint: !!data.customEntrypoint,
				customEntrypoint: data.customEntrypoint || undefined,
				certificateType: data?.certificateType || (data?.https ? "letsencrypt" : "none"),
				customCertResolver: data?.customCertResolver || undefined,
				serviceName: data?.serviceName || undefined,
				domainType: data?.domainType || type,
				middlewares: data?.middlewares || [],
			});
		}

		if (!domainId) {
			form.reset({
				host: "",
				path: "/",
				internalPath: "/",
				stripPath: false,
				port: 3000,
				useCustomEntrypoint: false,
				customEntrypoint: undefined,
				https: true,
				certificateType: "letsencrypt",
				customCertResolver: undefined,
				domainType: type,
				middlewares: [],
			});
		}
	}, [form, data, isPending, domainId]);

	useEffect(() => {
		if (certificateType === "custom") {
			form.trigger("customCertResolver");
		}
	}, [certificateType, form]);

	const dictionary = {
		success: domainId ? "Domain Updated" : "Domain Connected Successfully",
		error: domainId ? "Error updating the domain" : "Error connecting domain",
		submit: domainId ? "Update Domain" : "Connect Domain",
		dialogDescription: domainId
			? "Modify the domain settings for this application."
			: "Connect a custom domain or generate a free test subdomain.",
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		toast.success(`Copied "${text}" to clipboard`);
	};

	const onSubmit = async (formData: Domain) => {
		const payload = {
			...formData,
			path: formData.path || "/",
			port: formData.port || 3000,
			certificateType: formData.https
				? formData.certificateType || "letsencrypt"
				: "none",
			customEntrypoint: formData.useCustomEntrypoint
				? formData.customEntrypoint
				: null,
		};

		await mutateAsync({
			domainId,
			...(formData.domainType === "application" && {
				applicationId: id,
			}),
			...(formData.domainType === "compose" && {
				composeId: id,
			}),
			...payload,
		})
			.then(async () => {
				toast.success(
					dictionary.success,
					formData.domainType === "compose"
						? { description: COMPOSE_REDEPLOY_TOAST }
						: undefined,
				);

				if (formData.domainType === "application") {
					await utils.domain.byApplicationId.invalidate({
						applicationId: id,
					});
					await utils.application.readTraefikConfig.invalidate({
						applicationId: id,
					});
				} else if (formData.domainType === "compose") {
					await utils.domain.byComposeId.invalidate({
						composeId: id,
					});
				}

				if (domainId) {
					refetch();
				}
				setIsOpen(false);
			})
			.catch((e) => {
				toast.error(e?.message || dictionary.error);
			});
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<Globe className="size-5 text-primary" />
						{domainId ? "Edit Domain" : "Add Domain"}
					</DialogTitle>
					<DialogDescription>{dictionary.dialogDescription}</DialogDescription>
				</DialogHeader>

				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}
				{type === "compose" && <ComposeRedeployAlert className="mb-4" />}

				<Form {...form}>
					<form
						id="hook-form"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-5"
					>
						{/* Host Field */}
						<FormField
							control={form.control}
							name="host"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="text-sm font-semibold">
										Domain Name
									</FormLabel>
									<div className="flex gap-2">
										<FormControl>
											<Input
												placeholder="app.yourdomain.com or mywebsite.com"
												{...field}
												className="font-mono text-sm"
											/>
										</FormControl>
										<TooltipProvider delayDuration={0}>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="secondary"
														type="button"
														isLoading={isLoadingGenerate}
														onClick={() => {
															generateDomain({
																appName: application?.appName || "",
																serverId: application?.serverId || "",
															})
																.then((genDomain) => {
																	field.onChange(genDomain);
																	form.setValue("https", false);
																	form.setValue("certificateType", "none");
																})
																.catch((err) => {
																	toast.error(err.message);
																});
														}}
													>
														<Dices className="size-4 mr-1 text-muted-foreground" />
														<span className="text-xs">Free Test Subdomain</span>
													</Button>
												</TooltipTrigger>
												<TooltipContent side="left" className="max-w-52">
													<p>
														Generate an instant development subdomain (.sslip.io)
														requiring no DNS setup.
													</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* DNS Setup Guide Card for Custom Domains */}
						{isCustomDomain && dnsInfo && (
							<div className="p-4 rounded-lg border bg-muted/30 flex flex-col gap-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										{dnsInfo.verified ? (
											<Badge
												variant="outline"
												className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 flex items-center gap-1.5"
											>
												<CheckCircle2 className="size-3.5" />
												DNS Configured Correctly
											</Badge>
										) : (
											<Badge
												variant="outline"
												className="bg-amber-500/10 text-amber-600 border-amber-500/20 flex items-center gap-1.5"
											>
												<AlertCircle className="size-3.5" />
												Waiting for DNS Record
											</Badge>
										)}
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 text-xs flex items-center gap-1"
										disabled={isCheckingDns}
										onClick={() => refetchDns()}
									>
										{isCheckingDns ? (
											<Loader2 className="size-3 animate-spin" />
										) : (
											<RefreshCw className="size-3" />
										)}
										Check DNS
									</Button>
								</div>

								<div className="text-xs text-muted-foreground">
									{dnsInfo.message}
								</div>

								{!dnsInfo.verified && (
									<div className="p-3 bg-background rounded-md border text-xs flex flex-col gap-2">
										<span className="font-semibold text-foreground">
											Add this DNS record at your domain provider (Cloudflare,
											GoDaddy, Namecheap, etc.):
										</span>
										<div className="grid grid-cols-3 gap-2 py-1 font-mono text-xs">
											<div>
												<span className="text-muted-foreground block text-[10px] uppercase font-sans">
													Type
												</span>
												<span className="font-bold">{dnsInfo.recordType}</span>
											</div>
											<div>
												<span className="text-muted-foreground block text-[10px] uppercase font-sans">
													Name / Host
												</span>
												<span className="font-bold">{dnsInfo.recordName}</span>
											</div>
											<div className="flex items-center justify-between">
												<div>
													<span className="text-muted-foreground block text-[10px] uppercase font-sans">
														Value / Target
													</span>
													<span className="font-bold">{dnsInfo.recordValue}</span>
												</div>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="size-6"
													onClick={() => copyToClipboard(dnsInfo.recordValue)}
												>
													<Copy className="size-3" />
												</Button>
											</div>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Port Selection */}
						<FormField
							control={form.control}
							name="port"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="text-sm font-semibold">
										Application Port
									</FormLabel>
									<FormDescription className="text-xs">
										The internal port your application listens on (e.g. 3000 for
										Next.js/Node, 80 for Nginx, 8000 for Python).
									</FormDescription>
									<FormControl>
										<NumberInput
											placeholder="3000"
											{...field}
											className="font-mono text-sm"
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Automatic HTTPS Switch */}
						{!isTraefikMeDomain && (
							<FormField
								control={form.control}
								name="https"
								render={({ field }) => (
									<FormItem className="flex flex-row items-center justify-between p-3.5 border rounded-lg bg-card">
										<div className="space-y-0.5">
											<div className="flex items-center gap-1.5">
												<ShieldCheck className="size-4 text-emerald-500" />
												<FormLabel className="text-sm font-semibold cursor-pointer">
													Automatic HTTPS & SSL
												</FormLabel>
											</div>
											<FormDescription className="text-xs">
												SSL certificate will be issued automatically with Let's
												Encrypt once DNS points to this server.
											</FormDescription>
										</div>
										<FormControl>
											<Switch
												checked={field.value}
												onCheckedChange={(checked) => {
													field.onChange(checked);
													if (checked) {
														form.setValue("certificateType", "letsencrypt");
													} else {
														form.setValue("certificateType", "none");
													}
												}}
											/>
										</FormControl>
									</FormItem>
								)}
							/>
						)}

						{/* Advanced Settings Accordion */}
						<div className="pt-2 border-t">
							<button
								type="button"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1"
							>
								<span>Advanced Domain Configuration</span>
								{showAdvanced ? (
									<ChevronDown className="size-4" />
								) : (
									<ChevronRight className="size-4" />
								)}
							</button>

							{showAdvanced && (
								<div className="mt-4 flex flex-col gap-4 pl-1 border-l-2 border-primary/20">
									{/* Compose Service Selection */}
									{domainType === "compose" && (
										<FormField
											control={form.control}
											name="serviceName"
											render={({ field }) => (
												<FormItem className="w-full">
													<FormLabel>Service Name</FormLabel>
													<div className="flex gap-2">
														{isManualInput ? (
															<FormControl>
																<Input
																	placeholder="Enter compose service name"
																	{...field}
																/>
															</FormControl>
														) : (
															<Select
																onValueChange={field.onChange}
																defaultValue={field.value || ""}
															>
																<FormControl>
																	<SelectTrigger>
																		<SelectValue placeholder="Select service" />
																	</SelectTrigger>
																</FormControl>
																<SelectContent>
																	{services?.map((service, index) => (
																		<SelectItem
																			value={service}
																			key={`${service}-${index}`}
																		>
																			{service}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														)}
														<Button
															variant="secondary"
															type="button"
															onClick={() => setIsManualInput(!isManualInput)}
														>
															{isManualInput ? "Dropdown" : "Manual"}
														</Button>
													</div>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}

									{/* Path */}
									<FormField
										control={form.control}
										name="path"
										render={({ field }) => (
											<FormItem>
												<FormLabel>URL Path</FormLabel>
												<FormDescription className="text-xs">
													Route traffic on a subpath (defaults to "/")
												</FormDescription>
												<FormControl>
													<Input placeholder="/" {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									{/* Internal Path */}
									<FormField
										control={form.control}
										name="internalPath"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Internal Container Path</FormLabel>
												<FormDescription className="text-xs">
													Path forwarded to your application (defaults to "/")
												</FormDescription>
												<FormControl>
													<Input placeholder="/" {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									{/* Strip Path */}
									<FormField
										control={form.control}
										name="stripPath"
										render={({ field }) => (
											<FormItem className="flex flex-row items-center justify-between p-3 border rounded-lg">
												<div className="space-y-0.5">
													<FormLabel className="text-sm">Strip Path</FormLabel>
													<FormDescription className="text-xs">
														Strip URL path before sending request to container
													</FormDescription>
												</div>
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={field.onChange}
													/>
												</FormControl>
											</FormItem>
										)}
									/>

									{/* Certificate Provider */}
									{https && (
										<FormField
											control={form.control}
											name="certificateType"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Certificate Provider</FormLabel>
													<Select
														onValueChange={(val) => {
															field.onChange(val);
															if (val !== "custom") {
																form.setValue("customCertResolver", undefined);
															}
														}}
														value={field.value || "letsencrypt"}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder="Certificate Provider" />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value="letsencrypt">
																Let's Encrypt (Automatic)
															</SelectItem>
															<SelectItem value="none">
																Custom Certificate from Settings
															</SelectItem>
															<SelectItem value="custom">
																Custom Traefik Resolver
															</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}

									{/* Custom Cert Resolver */}
									{certificateType === "custom" && (
										<FormField
											control={form.control}
											name="customCertResolver"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Custom Resolver Name</FormLabel>
													<FormControl>
														<Input
															placeholder="e.g. myresolver"
															{...field}
															value={field.value || ""}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}

									{/* Custom Entrypoint */}
									<FormField
										control={form.control}
										name="useCustomEntrypoint"
										render={({ field }) => (
											<FormItem className="flex flex-row items-center justify-between p-3 border rounded-lg">
												<div className="space-y-0.5">
													<FormLabel className="text-sm">
														Custom Entrypoint
													</FormLabel>
													<FormDescription className="text-xs">
														Override Traefik web/websecure entrypoints
													</FormDescription>
												</div>
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={(checked) => {
															field.onChange(checked);
															if (!checked) {
																form.setValue("customEntrypoint", undefined);
															}
														}}
													/>
												</FormControl>
											</FormItem>
										)}
									/>

									{useCustomEntrypoint && (
										<FormField
											control={form.control}
											name="customEntrypoint"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Entrypoint Identifier</FormLabel>
													<FormControl>
														<Input
															placeholder="e.g. custom-port"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}

									{/* Middlewares */}
									<FormField
										control={form.control}
										name="middlewares"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Traefik Middlewares</FormLabel>
												<div className="flex flex-wrap gap-2 mb-2">
													{field.value?.map((name, index) => (
														<Badge key={index} variant="secondary">
															{name}
															<X
																className="ml-1 size-3 cursor-pointer"
																onClick={() => {
																	const updated = [...(field.value || [])];
																	updated.splice(index, 1);
																	form.setValue("middlewares", updated);
																}}
															/>
														</Badge>
													))}
												</div>
												<FormControl>
													<div className="flex gap-2">
														<Input
															placeholder="e.g., rate-limit@file, auth@file"
															onKeyDown={(e) => {
																if (e.key === "Enter") {
																	e.preventDefault();
																	const val = e.currentTarget.value.trim();
																	if (val && !field.value?.includes(val)) {
																		form.setValue("middlewares", [
																			...(field.value || []),
																			val,
																		]);
																		e.currentTarget.value = "";
																	}
																}
															}}
														/>
													</div>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							)}
						</div>

						<DialogFooter className="pt-2">
							<Button isLoading={isPending} form="hook-form" type="submit">
								{dictionary.submit}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
};
