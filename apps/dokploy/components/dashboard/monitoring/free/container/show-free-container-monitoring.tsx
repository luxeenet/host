import { formatMb } from "@dokploy/server/monitoring/units";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/utils/api";
import { DockerBlockChart } from "./docker-block-chart";
import { DockerCpuChart } from "./docker-cpu-chart";
import { DockerDiskChart } from "./docker-disk-chart";
import { DockerDiskUsageChart } from "./docker-disk-usage-chart";
import { DockerMemoryChart } from "./docker-memory-chart";
import { DockerNetworkChart } from "./docker-network-chart";

const defaultData = {
	cpu: {
		value: "0%",
		time: "",
	},
	memory: {
		value: {
			used: 0,
			total: 0,
		},
		time: "",
	},
	block: {
		value: {
			readMb: 0,
			writeMb: 0,
		},
		time: "",
	},
	network: {
		value: {
			inputMb: 0,
			outputMb: 0,
		},
		time: "",
	},
	disk: {
		value: { diskTotal: 0, diskUsage: 0, diskUsedPercentage: 0, diskFree: 0 },
		time: "",
	},
};

interface Props {
	appName: string;
	appType?: "application" | "stack" | "docker-compose";
}
export interface DockerStats {
	cpu: {
		value: string;
		time: string;
	};
	memory: {
		value: {
			used: number;
			total: number;
		};
		time: string;
	};
	block: {
		value: {
			readMb: number;
			writeMb: number;
		};
		time: string;
	};
	network: {
		value: {
			inputMb: number;
			outputMb: number;
		};
		time: string;
	};
	disk: {
		value: {
			diskTotal: number;
			diskUsage: number;
			diskUsedPercentage: number;
			diskFree: number;
		};

		time: string;
	};
}

export type DockerStatsJSON = {
	cpu: DockerStats["cpu"][];
	memory: DockerStats["memory"][];
	block: DockerStats["block"][];
	network: DockerStats["network"][];
	disk: DockerStats["disk"][];
};

export const convertMemoryToBytes = (
	memoryString: string | undefined,
): number => {
	if (!memoryString || typeof memoryString !== "string") {
		return 0;
	}

	const value = Number.parseFloat(memoryString) || 0;
	const unit = memoryString.replace(/[0-9.]/g, "").trim();

	switch (unit) {
		case "KiB":
			return value * 1024;
		case "MiB":
			return value * 1024 * 1024;
		case "GiB":
			return value * 1024 * 1024 * 1024;
		case "TiB":
			return value * 1024 * 1024 * 1024 * 1024;
		default:
			return value;
	}
};

export const ContainerFreeMonitoring = ({
	appName,
	appType = "application",
}: Props) => {
	const { data: monitoringResponse } = api.application.readAppMonitoring.useQuery(
		{ appName },
		{
			refetchOnWindowFocus: false,
		},
	);

	const data = (monitoringResponse as any)?.stats !== undefined
		? (monitoringResponse as any)?.stats
		: monitoringResponse;
	const serviceLimit = (monitoringResponse as any)?.serviceLimit ?? null;
	const entitlements = (monitoringResponse as any)?.entitlements ?? {
		hasAdvancedIoMetrics: true,
		hasHistoricalCharts: true,
		maxDataPoints: 300,
	};

	const [accumulativeData, setAccumulativeData] = useState<DockerStatsJSON>({
		cpu: [],
		memory: [],
		block: [],
		network: [],
		disk: [],
	});
	const [currentData, setCurrentData] = useState<DockerStats>(defaultData);
	const [hasReceivedStats, setHasReceivedStats] = useState(false);

	useEffect(() => {
		setCurrentData(defaultData);
		setHasReceivedStats(false);

		setAccumulativeData({
			cpu: [],
			memory: [],
			block: [],
			network: [],
			disk: [],
		});
	}, [appName]);

	useEffect(() => {
		if (!data) return;

		const hasCpu = (data.cpu?.length ?? 0) > 0;
		const hasMemory = (data.memory?.length ?? 0) > 0;
		if (hasCpu || hasMemory) {
			setHasReceivedStats(true);
		}

		setCurrentData({
			cpu: data.cpu[data.cpu.length - 1] ?? currentData.cpu,
			memory: data.memory[data.memory.length - 1] ?? currentData.memory,
			block: data.block[data.block.length - 1] ?? currentData.block,
			network: data.network[data.network.length - 1] ?? currentData.network,
			disk: data.disk[data.disk.length - 1] ?? currentData.disk,
		});
		setAccumulativeData({
			block: data?.block || [],
			cpu: data?.cpu || [],
			disk: data?.disk || [],
			memory: data?.memory || [],
			network: data?.network || [],
		});
	}, [data]);

	useEffect(() => {
		if (!appName) return;

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/listen-docker-stats-monitoring?appName=${appName}&appType=${appType}`;
		const ws = new WebSocket(wsUrl);

		ws.onmessage = (e) => {
			const value = JSON.parse(e.data);
			if (!value) return;

			setHasReceivedStats(true);

			const data = {
				cpu: value.data.cpu ?? currentData.cpu,
				memory: value.data.memory ?? currentData.memory,
				block: value.data.block ?? currentData.block,
				disk: value.data.disk ?? currentData.disk,
				network: value.data.network ?? currentData.network,
			};

			setCurrentData(data);

			const maxPoints = entitlements?.maxDataPoints ?? 300;
			setAccumulativeData((prevData) => ({
				cpu: [...prevData.cpu, data.cpu].slice(-maxPoints),
				memory: [...prevData.memory, data.memory].slice(-maxPoints),
				block: [...prevData.block, data.block].slice(-maxPoints),
				network: [...prevData.network, data.network].slice(-maxPoints),
				disk: [...prevData.disk, data.disk].slice(-maxPoints),
			}));
		};

		ws.onclose = (e) => {
			if (e.reason) {
				toast.error(e.reason);
			}
		};

		return () => ws.close();
	}, [appName, entitlements?.maxDataPoints]);

	const effectiveMemoryLimitLabel = serviceLimit?.memoryLimitFormatted ?? (
		currentData.memory.value.total &&
		String(currentData.memory.value.total) !== "0" &&
		String(currentData.memory.value.total) !== "0B" &&
		String(currentData.memory.value.total) !== "No custom memory limit"
			? String(currentData.memory.value.total)
			: null
	);
	const hasMemoryLimit = Boolean(effectiveMemoryLimitLabel);
	const totalMemoryBytes = serviceLimit?.memoryLimitBytes ?? convertMemoryToBytes(String(currentData.memory.value.total ?? "0"));
	const usedMemoryBytes = convertMemoryToBytes(String(currentData.memory.value.used ?? "0"));
	const memoryPercentage = hasMemoryLimit && totalMemoryBytes > 0
		? Math.min((usedMemoryBytes / totalMemoryBytes) * 100, 100)
		: 0;

	const effectiveCpuLimitLabel = serviceLimit?.cpuLimitFormatted ?? null;

	return (
		<div className="rounded-xl bg-background flex flex-col gap-4">
			<header className="flex items-center justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">Resource Utilization</h1>
					<p className="text-sm text-muted-foreground">
						Live container performance and resource metrics for this service
					</p>
				</div>
			</header>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								{!hasReceivedStats
									? "Status: Metric unavailable"
									: effectiveCpuLimitLabel
										? `Used: ${String(currentData.cpu.value ?? "0%")} / Limit: ${effectiveCpuLimitLabel}`
										: `Used: ${String(currentData.cpu.value ?? "0%")} (No custom CPU limit)`}
							</span>
							<Progress
								value={
									hasReceivedStats
										? Number.parseInt(
												String(currentData.cpu.value ?? "0%").replace("%", ""),
												10,
											) || 0
										: 0
								}
								className="w-full"
							/>
							{entitlements?.hasHistoricalCharts ? (
								<DockerCpuChart accumulativeData={accumulativeData.cpu} />
							) : (
								<p className="text-xs text-muted-foreground pt-1">
									Real-time CPU metrics active. Historical charts available on Developer plan and above.
								</p>
							)}
						</div>
					</CardContent>
				</Card>
				<Card className="bg-background">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-2 w-full">
							<span className="text-sm text-muted-foreground">
								{!hasReceivedStats
									? "Status: Metric unavailable"
									: hasMemoryLimit
										? `Used: ${currentData.memory.value.used} / Limit: ${effectiveMemoryLimitLabel}`
										: `Used: ${currentData.memory.value.used || "0 MB"} (No custom memory limit)`}
							</span>
							<Progress
								value={hasReceivedStats && hasMemoryLimit ? memoryPercentage : 0}
								className="w-full"
							/>
							{entitlements?.hasHistoricalCharts ? (
								<DockerMemoryChart
									accumulativeData={accumulativeData.memory}
									memoryLimitGB={
										hasMemoryLimit ? totalMemoryBytes / 1024 ** 3 : 0
									}
								/>
							) : (
								<p className="text-xs text-muted-foreground pt-1">
									Real-time memory metrics active. Historical charts available on Developer plan and above.
								</p>
							)}
						</div>
					</CardContent>
				</Card>
				{appName === "dokploy" && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Disk Space</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2 w-full">
								<span className="text-sm text-muted-foreground">
									{`Used:  ${currentData.disk.value.diskUsage} GB / Limit: ${currentData.disk.value.diskTotal} GB`}
								</span>
								<Progress
									value={currentData.disk.value.diskUsedPercentage}
									className="w-full"
								/>
								<DockerDiskChart
									accumulativeData={accumulativeData.disk}
									diskTotal={currentData.disk.value.diskTotal}
								/>
							</div>
						</CardContent>
					</Card>
				)}
				{appName === "dokploy" && (
					<Card className="bg-background">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								Docker Disk Usage
							</CardTitle>
						</CardHeader>
						<CardContent>
							<DockerDiskUsageChart />
						</CardContent>
					</Card>
				)}

				{entitlements?.hasAdvancedIoMetrics && (
					<>
						<Card className="bg-background">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Block I/O</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-col gap-2 w-full">
									<span className="text-sm text-muted-foreground">
										{!hasReceivedStats
											? "Status: Waiting for activity..."
											: `Read: ${formatMb(currentData.block.value.readMb)} / Write: ${formatMb(currentData.block.value.writeMb)}`}
									</span>
									<DockerBlockChart accumulativeData={accumulativeData.block} />
								</div>
							</CardContent>
						</Card>
						<Card className="bg-background">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Network I/O</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-col gap-2 w-full">
									<span className="text-sm text-muted-foreground">
										{!hasReceivedStats
											? "Status: Waiting for activity..."
											: `In: ${formatMb(currentData.network.value.inputMb)} / Out: ${formatMb(currentData.network.value.outputMb)}`}
									</span>
									<DockerNetworkChart accumulativeData={accumulativeData.network} />
								</div>
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</div>
	);
};
