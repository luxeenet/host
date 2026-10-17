import { toast } from "sonner";
import { ToggleVisibilityInput } from "@/components/shared/toggle-visibility-input";
import { UpdateDatabasePassword } from "@/components/shared/update-database-password";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/utils/api";

interface Props {
	mongoId: string;
}
export const ShowInternalMongoCredentials = ({ mongoId }: Props) => {
	const { data } = api.mongo.one.useQuery({ mongoId });
	const utils = api.useUtils();
	const { mutateAsync: changePassword } =
		api.mongo.changePassword.useMutation();
	return (
		<>
			<div className="flex w-full flex-col gap-5 ">
				<Card className="bg-background">
					<CardHeader>
						<CardTitle className="text-xl">Internal Credentials</CardTitle>
					</CardHeader>
					<CardContent className="flex w-full flex-col gap-4">
						<div className="flex flex-col gap-1 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 p-3 rounded-lg">
							<span className="font-semibold">Private Swarm Network Only</span>
							<p>
								These credentials and internal URL (using host <code>{data?.appName}</code>) are strictly for services inside HatDot. External desktop clients (MongoDB Compass) cannot resolve this host. Use Public Credentials to connect externally.
							</p>
						</div>
						<div className="grid w-full md:grid-cols-2 gap-4 md:gap-8">
							<div className="flex flex-col gap-2">
								<Label>User</Label>
								<Input enableCopyButton disabled value={data?.databaseUser} />
							</div>

							<div className="flex flex-col gap-2">
								<Label>Password</Label>
								<div className="flex flex-row gap-2 items-center">
									<ToggleVisibilityInput
										disabled
										value={data?.databasePassword}
									/>
									<UpdateDatabasePassword
										onUpdatePassword={async (newPassword) => {
											await changePassword({
												mongoId,
												password: newPassword,
											});
											toast.success("Password updated successfully");
											utils.mongo.one.invalidate({ mongoId });
										}}
									/>
								</div>
							</div>

							<div className="flex flex-col gap-2">
								<Label>Internal Port (Container)</Label>
								<Input disabled value="27017" />
							</div>

							<div className="flex flex-col gap-2">
								<Label>Internal Host</Label>
								<Input enableCopyButton disabled value={data?.appName} />
							</div>

							<div className="flex flex-col gap-2 md:col-span-2">
								<Label>Internal Connection URL </Label>
								<ToggleVisibilityInput
									disabled
									value={`mongodb://${encodeURIComponent(data?.databaseUser || "")}:${encodeURIComponent(data?.databasePassword || "")}@${data?.appName}:27017/${encodeURIComponent((data as any)?.databaseName || "app")}?authSource=${encodeURIComponent((data as any)?.databaseName || "app")}${data?.replicaSets ? "" : "&directConnection=true"}`}
								/>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</>
	);
};
