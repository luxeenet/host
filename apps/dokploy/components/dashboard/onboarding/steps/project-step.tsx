import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
	FolderGit2,
	AlignLeft,
	ArrowRight,
	Sparkles,
	ShieldCheck,
	Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { displayFont } from "../font";

const schema = z.object({
	name: z.string().min(1, "Project name is required"),
	description: z.string().optional(),
});
type Schema = z.infer<typeof schema>;

interface Props {
	onNext: (project: { projectId: string; environmentId: string }) => void;
	/** Drops the onboarding wizard's display serif for callers that want the app's regular typography. */
	plainTitle?: boolean;
}

const PRESETS = [
	{ name: "Production App", description: "Primary customer-facing live service" },
	{ name: "API & Backend", description: "Microservices and background job runners" },
	{ name: "Staging Preview", description: "Pre-release testing and QA environment" },
	{ name: "Client Project", description: "Dedicated managed client workspace" },
];

export const ProjectStep = ({ onNext, plainTitle }: Props) => {
	const titleClassName = plainTitle
		? "text-xl font-semibold tracking-tight"
		: `${displayFont.className} text-4xl sm:text-5xl leading-[1.08] tracking-tight font-bold`;

	const { mutateAsync, isPending } = api.project.create.useMutation();
	const utils = api.useUtils();

	const form = useForm<Schema>({
		defaultValues: { name: "My First Project", description: "Production workspace" },
		resolver: zodResolver(schema),
	});

	const onSubmit = async (data: Schema) => {
		try {
			const result = await mutateAsync(data);
			await utils.project.all.invalidate();
			toast.success("Workspace environment created successfully 🎉");
			onNext({
				projectId: result.project.projectId,
				environmentId: result.environment?.environmentId ?? "",
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Error creating the project",
			);
		}
	};

	const applyPreset = (preset: typeof PRESETS[0]) => {
		form.setValue("name", preset.name, { shouldValidate: true });
		form.setValue("description", preset.description, { shouldValidate: true });
	};

	return (
		<div className="flex flex-col gap-8 max-w-xl">
			{/* Header */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Badge
						variant="outline"
						className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] font-medium px-2.5 py-0.5 tracking-wide flex items-center gap-1.5"
					>
						<FolderGit2 className="size-3 text-amber-400 shrink-0" />
						Step 02 — Cloud Workspace
					</Badge>
				</div>

				<h1 className={titleClassName}>Create your first project.</h1>
				<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
					Projects organize your web applications, databases, environment variables, and domains
					within an isolated private tenant space.
				</p>
			</div>

			{/* Quick Preset Selector */}
			<div className="space-y-2">
				<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
					<Sparkles className="size-3 text-amber-400" />
					Quick templates
				</span>
				<div className="grid grid-cols-2 gap-2">
					{PRESETS.map((p) => (
						<button
							key={p.name}
							type="button"
							onClick={() => applyPreset(p)}
							className="text-left p-2.5 rounded-xl border border-border/80 bg-card/60 hover:bg-card/90 hover:border-amber-500/30 transition-all text-xs"
						>
							<div className="font-semibold text-foreground">{p.name}</div>
							<div className="text-[10px] text-muted-foreground truncate">
								{p.description}
							</div>
						</button>
					))}
				</div>
			</div>

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
					<FormField
						control={form.control}
						name="name"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs font-semibold text-foreground flex items-center gap-1.5">
									<FolderGit2 className="size-3.5 text-muted-foreground" />
									Project Name
								</FormLabel>
								<FormControl>
									<Input
										placeholder="e.g. Production App"
										className="h-11 bg-card/80 border-border focus:border-amber-500/60"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="description"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs font-semibold text-foreground flex items-center gap-1.5">
									<AlignLeft className="size-3.5 text-muted-foreground" />
									Description (optional)
								</FormLabel>
								<FormControl>
									<Textarea
										placeholder="What will run in this workspace?"
										className="resize-none h-20 bg-card/80 border-border focus:border-amber-500/60 text-xs"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					{/* Security Notice */}
					<div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/40 border border-border/60 text-[11px] text-muted-foreground">
						<Lock className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
						<span>
							Each project operates in an isolated private cloud environment with dedicated
							secrets management and automated SSL routing.
						</span>
					</div>

					<Button
						type="submit"
						size="lg"
						isLoading={isPending}
						className="w-fit px-8 h-11 mt-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg shadow-amber-600/20 group gap-2"
					>
						<span>Create project &amp; continue</span>
						<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
					</Button>
				</form>
			</Form>
		</div>
	);
};
