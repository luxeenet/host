import { db } from "../db";
import { deployments } from "../db/schema/deployment";
import { applications } from "../db/schema/application";
import { rollbacks } from "../db/schema/rollbacks";
import { eq, desc, and } from "drizzle-orm";
import { analyzeBuildFailure } from "./failure-recovery";

export interface BuilderMetricBreakdown {
	name: string;
	total: number;
	successful: number;
	failed: number;
	successRate: number;
}

export interface FailureReasonSummary {
	code: string;
	title: string;
	count: number;
	percentage: number;
	recommendation: string;
}

export interface BuilderAnalyticsReport {
	period: "all_time" | "last_30_days";
	totalDeployments: number;
	successfulDeployments: number;
	failedDeployments: number;
	cancelledDeployments: number;
	overallSuccessRate: number;
	overallFailureRate: number;
	averageBuildDurationSeconds: number;
	totalRollbacks: number;
	builderBreakdown: BuilderMetricBreakdown[];
	frameworkBreakdown: BuilderMetricBreakdown[];
	topFailureReasons: FailureReasonSummary[];
	generatedAt: string;
}

/**
 * Aggregates builder performance, deployment metrics and failure classifications
 * to give platform administrators deep observability into hosting reliability.
 */
export const getBuilderAnalytics = async (
	_organizationId?: string,
): Promise<BuilderAnalyticsReport> => {
	const allDeployments = await db.query.deployments.findMany({
		with: {
			application: true,
		},
		orderBy: [desc(deployments.createdAt)],
		limit: 500,
	});

	const allRollbacks = await db.query.rollbacks.findMany({
		limit: 100,
	});

	let successful = 0;
	let failed = 0;
	let cancelled = 0;
	let totalDurationMs = 0;
	let durationSamples = 0;

	const builderMap = new Map<string, { total: number; successful: number; failed: number }>();
	const frameworkMap = new Map<string, { total: number; successful: number; failed: number }>();
	const failureCountMap = new Map<string, { title: string; count: number; recommendation: string }>();

	for (const dep of allDeployments) {
		const status = dep.status;
		const app = dep.application;
		const builder = (app as any)?.buildType || "nixpacks";
		const framework = "Application";

		// Update builder counts
		const bEntry = builderMap.get(builder) || { total: 0, successful: 0, failed: 0 };
		bEntry.total++;

		const fEntry = frameworkMap.get(framework) || { total: 0, successful: 0, failed: 0 };
		fEntry.total++;

		if (status === "done") {
			successful++;
			bEntry.successful++;
			fEntry.successful++;
		} else if (status === "error") {
			failed++;
			bEntry.failed++;
			fEntry.failed++;

			// Classify error
			const errorText = dep.errorMessage || "Unknown error";
			const diagnosis = analyzeBuildFailure(errorText);
			const existingFailure = failureCountMap.get(diagnosis.code) || {
				title: diagnosis.title,
				count: 0,
				recommendation: diagnosis.recommendedCorrection,
			};
			existingFailure.count++;
			failureCountMap.set(diagnosis.code, existingFailure);
		} else if (status === "cancelled") {
			cancelled++;
		}

		builderMap.set(builder, bEntry);
		frameworkMap.set(framework, fEntry);

		// Calculate duration if start and finish timestamps exist
		if (dep.startedAt && dep.finishedAt) {
			const start = new Date(dep.startedAt).getTime();
			const finish = new Date(dep.finishedAt).getTime();
			if (finish > start) {
				totalDurationMs += finish - start;
				durationSamples++;
			}
		}
	}

	const total = allDeployments.length;
	const successRate = total > 0 ? Number(((successful / total) * 100).toFixed(1)) : 100;
	const failureRate = total > 0 ? Number(((failed / total) * 100).toFixed(1)) : 0;
	const avgDurationSec = durationSamples > 0 ? Math.round(totalDurationMs / durationSamples / 1000) : 45;

	const builderBreakdown: BuilderMetricBreakdown[] = Array.from(builderMap.entries()).map(([name, stat]) => ({
		name,
		total: stat.total,
		successful: stat.successful,
		failed: stat.failed,
		successRate: stat.total > 0 ? Number(((stat.successful / stat.total) * 100).toFixed(1)) : 0,
	}));

	const frameworkBreakdown: BuilderMetricBreakdown[] = Array.from(frameworkMap.entries()).map(([name, stat]) => ({
		name,
		total: stat.total,
		successful: stat.successful,
		failed: stat.failed,
		successRate: stat.total > 0 ? Number(((stat.successful / stat.total) * 100).toFixed(1)) : 0,
	}));

	const topFailureReasons: FailureReasonSummary[] = Array.from(failureCountMap.entries())
		.map(([code, info]) => ({
			code,
			title: info.title,
			count: info.count,
			percentage: failed > 0 ? Number(((info.count / failed) * 100).toFixed(1)) : 0,
			recommendation: info.recommendation,
		}))
		.sort((a, b) => b.count - a.count);

	return {
		period: "all_time",
		totalDeployments: total,
		successfulDeployments: successful,
		failedDeployments: failed,
		cancelledDeployments: cancelled,
		overallSuccessRate: successRate,
		overallFailureRate: failureRate,
		averageBuildDurationSeconds: avgDurationSec,
		totalRollbacks: allRollbacks.length,
		builderBreakdown,
		frameworkBreakdown,
		topFailureReasons,
		generatedAt: new Date().toISOString(),
	};
};

export interface BuildExecutionRecord {
	id: string;
	applicationId: string;
	builder: string;
	framework: string;
	status: "success" | "failed" | "cancelled";
	durationMs: number;
	failureCode?: string;
	attemptCount?: number;
	timestamp: string;
}

const memoryMetrics: BuildExecutionRecord[] = [];

export const recordBuildMetric = (record: BuildExecutionRecord) => {
	memoryMetrics.push(record);
	if (memoryMetrics.length > 500) {
		memoryMetrics.shift();
	}
};

export const calculateBuilderAnalytics = (records: BuildExecutionRecord[] = memoryMetrics) => {
	const total = records.length;
	let successful = 0;
	let failed = 0;
	const byBuilder: Record<string, { total: number; success: number; failed: number }> = {};
	const failureMap = new Map<string, number>();

	for (const r of records) {
		const entry = byBuilder[r.builder] ?? { total: 0, success: 0, failed: 0 };
		byBuilder[r.builder] = entry;
		entry.total++;

		if (r.status === "success") {
			successful++;
			entry.success++;
		} else if (r.status === "failed") {
			failed++;
			entry.failed++;
			if (r.failureCode) {
				failureMap.set(r.failureCode, (failureMap.get(r.failureCode) || 0) + 1);
			}
		}
	}

	const topFailureReasons = Array.from(failureMap.entries())
		.map(([code, count]) => ({ code, count }))
		.sort((a, b) => b.count - a.count);

	return {
		totalBuilds: total,
		successfulBuilds: successful,
		failedBuilds: failed,
		successRate: total > 0 ? (successful / total) * 100 : 100,
		byBuilder,
		topFailureReasons,
	};
};
