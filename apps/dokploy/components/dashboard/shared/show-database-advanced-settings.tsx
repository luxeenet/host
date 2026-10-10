import { ChevronDown, ChevronUp, Layers, Server } from "lucide-react";
import { useState } from "react";
import { ShowResources } from "@/components/dashboard/application/advanced/show-resources";
import { ShowVolumes } from "@/components/dashboard/application/advanced/volumes/show-volumes";
import { AssignNetworks } from "@/components/dashboard/networks/assign-networks";
import { ShowCustomCommand } from "@/components/dashboard/postgres/advanced/show-custom-command";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/utils/api";
import { ShowClusterSettings } from "../application/advanced/cluster/show-cluster-settings";
import { RebuildDatabase } from "./rebuild-database";

interface Props {
	id: string;
	type: "libsql" | "mariadb" | "mongo" | "mysql" | "postgres" | "redis";
}

export const ShowDatabaseAdvancedSettings = ({ id, type }: Props) => {
	const { data: auth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean(
		(auth as any)?.user?.isPlatformAdmin || (auth as any)?.isPlatformAdmin,
	);
	const [showInfraOverrides, setShowInfraOverrides] = useState(false);

	return (
		<div className="flex w-full flex-col gap-6">
			{/* Safe Customer Controls: Resource Allocations */}
			<ShowResources id={id} type={type} />

			{/* Platform Infrastructure Overrides (for platform administrators only) */}
			{isPlatformAdmin && (
				<Card className="bg-background border-border">
					<CardHeader className="cursor-pointer" onClick={() => setShowInfraOverrides(!showInfraOverrides)}>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Server className="size-5 text-muted-foreground" />
								<div>
									<CardTitle className="text-base font-semibold">
										Platform Infrastructure & Container Settings
									</CardTitle>
									<CardDescription className="text-xs">
										Low-level Docker Swarm placement, custom container commands, internal volume mounts, and network attachment.
									</CardDescription>
								</div>
							</div>
							<Button variant="ghost" size="sm" type="button">
								{showInfraOverrides ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
							</Button>
						</div>
					</CardHeader>
					{showInfraOverrides && (
						<CardContent className="flex flex-col gap-5 pt-0 border-t mt-4">
							<ShowCustomCommand id={id} type={type} />
							{(type === "mariadb" ||
							type === "mongo" ||
							type === "mysql" ||
							type === "postgres" ||
							type === "redis") && (
								<ShowClusterSettings id={id} type={type} />
							)}
							<ShowVolumes id={id} type={type} />
							<AssignNetworks id={id} type={type} />
						</CardContent>
					)}
				</Card>
			)}

			{/* Protected Destructive Actions (platform administrators only) */}
			{isPlatformAdmin && <RebuildDatabase id={id} type={type} />}
		</div>
	);
};
