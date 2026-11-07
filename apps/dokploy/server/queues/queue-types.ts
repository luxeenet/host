type DeployJob =
	| {
			applicationId: string;
			organizationId?: string;
			projectId?: string;
			deploymentId?: string;
			titleLog: string;
			descriptionLog: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "application";
			serverId?: string;
			domainReplacement?: {
				newDomainId: string;
				previousPrimaryDomainId?: string | null;
			};
	  }
	| {
			composeId: string;
			organizationId?: string;
			projectId?: string;
			deploymentId?: string;
			titleLog: string;
			descriptionLog: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "compose";
			serverId?: string;
			freshVolumes?: boolean;
			domainReplacement?: {
				newDomainId: string;
				previousPrimaryDomainId?: string | null;
			};
	  }
	| {
			applicationId: string;
			organizationId?: string;
			projectId?: string;
			deploymentId?: string;
			titleLog: string;
			descriptionLog: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "application-preview";
			previewDeploymentId: string;
			serverId?: string;
	  };

export type DeploymentJob = DeployJob;
