import {
	Activity,
	BlocksIcon,
	ChevronsUpDown,
	CreditCard,
	Folder,
	GalleryVerticalEnd,
	LogOut,
	Server,
	ShieldCheck,
	User,
} from "lucide-react";
import { useRouter } from "next/router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { getFallbackAvatarInitials } from "@/lib/utils";
import { api } from "@/utils/api";
import { ModeToggle } from "../ui/modeToggle";
import { SidebarMenuButton } from "../ui/sidebar";

const _AUTO_CHECK_UPDATES_INTERVAL_MINUTES = 7;

export const UserNav = () => {
	const router = useRouter();
	const { data } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();

	const isPlatformAdmin =
		Boolean(data?.user?.isPlatformAdmin) ||
		Boolean((data?.user as any)?.x_pa) ||
		Boolean((data as any)?.isPlatformAdmin);

	const canAccessBilling =
		data?.role === "owner" ||
		data?.role === "admin" ||
		Boolean(permissions?.organization?.update);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton
					size="lg"
					className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
				>
					<Avatar className="h-8 w-8 rounded-lg">
						<AvatarImage
							className="object-cover"
							src={data?.user?.image || ""}
							alt={data?.user?.image || ""}
						/>
						<AvatarFallback className="rounded-lg">
							{getFallbackAvatarInitials(
								`${data?.user?.firstName} ${data?.user?.lastName}`.trim(),
							)}
						</AvatarFallback>
					</Avatar>
					<div className="grid flex-1 text-left text-sm leading-tight">
						<span className="truncate font-semibold">Account</span>
						<span className="truncate text-xs">{data?.user?.email}</span>
					</div>
					<ChevronsUpDown className="ml-auto size-4" />
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
				side="bottom"
				align="end"
				sideOffset={4}
			>
				<div className="flex items-center justify-between px-2 py-1.5">
					<DropdownMenuLabel className="flex flex-col">
						My Account
						<span className="text-xs font-normal text-muted-foreground">
							{data?.user?.email}
						</span>
					</DropdownMenuLabel>
					<ModeToggle />
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						className="cursor-pointer flex items-center gap-2"
						onClick={() => {
							router.push("/dashboard/settings/profile");
						}}
					>
						<User className="size-4 text-muted-foreground" />
						<span>Profile</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer flex items-center gap-2"
						onClick={() => {
							router.push("/dashboard/home");
						}}
					>
						<Folder className="size-4 text-muted-foreground" />
						<span>Projects</span>
					</DropdownMenuItem>
					{canAccessBilling && (
						<DropdownMenuItem
							className="cursor-pointer flex items-center gap-2"
							onClick={() => {
								router.push("/dashboard/billing");
							}}
						>
							<CreditCard className="size-4 text-muted-foreground" />
							<span>Billing</span>
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
				{isPlatformAdmin && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase px-2 py-1">
							Administration
						</DropdownMenuLabel>
						<DropdownMenuGroup>
							<DropdownMenuItem
								className="cursor-pointer flex items-center gap-2"
								onClick={() => {
									router.push("/admin");
								}}
							>
								<ShieldCheck className="size-4 text-muted-foreground" />
								<span>Admin Portal</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer flex items-center gap-2"
								onClick={() => {
									router.push("/dashboard/monitoring");
								}}
							>
								<Activity className="size-4 text-muted-foreground" />
								<span>Monitoring</span>
							</DropdownMenuItem>
							{permissions?.traefikFiles.read && (
								<DropdownMenuItem
									className="cursor-pointer flex items-center gap-2"
									onClick={() => {
										router.push("/dashboard/traefik");
									}}
								>
									<GalleryVerticalEnd className="size-4 text-muted-foreground" />
									<span>Traefik</span>
								</DropdownMenuItem>
							)}
							{permissions?.docker.read && (
								<DropdownMenuItem
									className="cursor-pointer flex items-center gap-2"
									onClick={() => {
										router.push("/dashboard/docker", undefined, {
											shallow: true,
										});
									}}
								>
									<BlocksIcon className="size-4 text-muted-foreground" />
									<span>Docker</span>
								</DropdownMenuItem>
							)}
							{permissions?.organization.update && (
								<DropdownMenuItem
									className="cursor-pointer flex items-center gap-2"
									onClick={() => {
										router.push("/dashboard/settings/servers");
									}}
								>
									<Server className="size-4 text-muted-foreground" />
									<span>Servers</span>
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="cursor-pointer flex items-center gap-2 text-destructive focus:text-destructive"
					onClick={async () => {
						await authClient.signOut().then(() => {
							router.push("/");
						});
					}}
				>
					<LogOut className="size-4" />
					<span>Log out</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
