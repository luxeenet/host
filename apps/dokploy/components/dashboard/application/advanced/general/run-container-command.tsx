import { CheckCircle2, Clock, Code2, Play, Terminal, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/utils/api";

interface Props {
	applicationId: string;
}

const COMMON_PRESETS = [
	{ label: "Prisma Migrate", cmd: "npx prisma migrate deploy" },
	{ label: "NPM Migrate", cmd: "npm run migrate" },
	{ label: "Artisan Migrate", cmd: "php artisan migrate --force" },
	{ label: "Django Migrate", cmd: "python manage.py migrate" },
	{ label: "Print Env", cmd: "env" },
];

export const RunContainerCommand = ({ applicationId }: Props) => {
	const [command, setCommand] = useState("");
	const [result, setResult] = useState<{
		stdout: string;
		stderr: string;
		exitCode: number;
		executionTimeMs: number;
		truncated: boolean;
	} | null>(null);

	const { mutateAsync: runCommand, isPending } =
		api.application.runContainerCommand.useMutation();

	const handleExecute = async (cmdToRun?: string) => {
		const targetCmd = (cmdToRun || command).trim();
		if (!targetCmd) {
			toast.error("Please enter a command to execute");
			return;
		}

		try {
			const res = await runCommand({
				applicationId,
				command: targetCmd,
			});
			setResult(res);
			if (res.exitCode === 0) {
				toast.success("Command executed successfully");
			} else {
				toast.error(`Command exited with status code ${res.exitCode}`);
			}
		} catch (err: any) {
			toast.error(
				err?.message || "Failed to execute command inside application container",
			);
		}
	};

	return (
		<Card className="bg-background">
			<CardHeader className="flex flex-row justify-between flex-wrap gap-4">
				<div>
					<div className="flex items-center gap-2">
						<Terminal className="size-5 text-primary" />
						<CardTitle className="text-xl">Execute Container Command</CardTitle>
					</div>
					<CardDescription className="pt-1">
						Run migrations, diagnostic tools, or administrative commands
						directly inside this application&apos;s active container.
					</CardDescription>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline" className="text-xs font-normal">
						Container Isolated
					</Badge>
					<Badge variant="outline" className="text-xs font-normal">
						30s Timeout
					</Badge>
					<Badge variant="outline" className="text-xs font-normal">
						100KB Limit
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<div className="flex gap-2">
						<div className="relative flex-1">
							<Code2 className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
							<Input
								placeholder="e.g. npx prisma migrate deploy, npm run db:migrate"
								value={command}
								onChange={(e) => setCommand(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleExecute();
									}
								}}
								className="pl-9 font-mono text-sm"
								disabled={isPending}
							/>
						</div>
						<Button
							onClick={() => handleExecute()}
							disabled={isPending || !command.trim()}
							isLoading={isPending}
							className="gap-2"
						>
							<Play className="size-4" />
							Run
						</Button>
					</div>

					{/* Quick preset snippets */}
					<div className="flex flex-wrap items-center gap-1.5 pt-1">
						<span className="text-xs text-muted-foreground mr-1">Presets:</span>
						{COMMON_PRESETS.map((preset) => (
							<Button
								key={preset.label}
								type="button"
								variant="outline"
								size="sm"
								className="h-6 text-xs px-2 py-0 font-mono text-muted-foreground hover:text-foreground"
								onClick={() => {
									setCommand(preset.cmd);
								}}
							>
								{preset.label}
							</Button>
						))}
					</div>
				</div>

				{result && (
					<div className="flex flex-col gap-2 pt-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<span className="text-sm font-medium">Result</span>
								{result.exitCode === 0 ? (
									<Badge
										variant="outline"
										className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 flex items-center gap-1"
									>
										<CheckCircle2 className="size-3" /> Exit Code 0 (Success)
									</Badge>
								) : (
									<Badge
										variant="destructive"
										className="flex items-center gap-1"
									>
										<XCircle className="size-3" /> Exit Code {result.exitCode}
									</Badge>
								)}
								<span className="text-xs text-muted-foreground flex items-center gap-1">
									<Clock className="size-3" />
									{result.executionTimeMs}ms
								</span>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-muted-foreground hover:text-foreground"
								onClick={() => setResult(null)}
							>
								Clear Output
							</Button>
						</div>

						{result.truncated && (
							<AlertBlock type="warning">
								Output exceeded the 100KB safety limit and has been truncated.
							</AlertBlock>
						)}

						<div className="rounded-lg bg-slate-950 p-4 border border-slate-800 font-mono text-xs overflow-x-auto max-h-96">
							{result.stdout && (
								<pre className="text-emerald-300 whitespace-pre-wrap break-words">
									{result.stdout}
								</pre>
							)}
							{result.stderr && (
								<pre className="text-red-400 whitespace-pre-wrap break-words pt-1">
									{result.stderr}
								</pre>
							)}
							{!result.stdout && !result.stderr && (
								<span className="text-slate-500 italic">
									(Command finished with no output)
								</span>
							)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
};

