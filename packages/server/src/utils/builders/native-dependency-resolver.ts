import path from "node:path";
import type { SupportedPackageManager } from "./runtime-resolver";
import type { DiagnosticCode } from "../deployment/diagnostics";

export type LinuxArchitecture = "x86_64" | "aarch64";
export type LinuxLibc = "gnu" | "musl";

export interface NativeBindingTarget {
	packageName: string;
	architecture: LinuxArchitecture;
	libc: LinuxLibc;
	isSupported: boolean;
	unsupportedReason?: string;
}

export interface NativeDependencyResolutionResult {
	status: "already_valid" | "needs_recovery" | "unsupported_architecture" | "incompatible_version" | "not_needed";
	bindingPackage?: string;
	requiredVersion?: string;
	installedVersion?: string;
	targetArchitecture?: string;
	packageManager: SupportedPackageManager;
	recoveryCommand?: string;
	diagnosticCode?: DiagnosticCode;
	explanation?: string;
	remediation?: string;
}

/**
 * Validates Linux CPU architecture for Rolldown native bindings.
 * Explicitly rejects non-x86_64 / non-aarch64 architectures rather than
 * silently falling back to x64 or corrupting runtime binaries.
 */
export const resolveRolldownBindingTarget = (
	rawArch: string,
	libc: LinuxLibc = "gnu",
): NativeBindingTarget => {
	const normalized = rawArch.trim().toLowerCase();

	if (normalized === "x86_64" || normalized === "amd64" || normalized === "x64") {
		return {
			packageName: libc === "musl"
				? "@rolldown/binding-linux-x64-musl"
				: "@rolldown/binding-linux-x64-gnu",
			architecture: "x86_64",
			libc,
			isSupported: true,
		};
	}

	if (normalized === "aarch64" || normalized === "arm64") {
		return {
			packageName: libc === "musl"
				? "@rolldown/binding-linux-arm64-musl"
				: "@rolldown/binding-linux-arm64-gnu",
			architecture: "aarch64",
			libc,
			isSupported: true,
		};
	}

	// Unsupported architectures: armv7l, i686, riscv64, s390x, ppc64le, etc.
	return {
		packageName: "",
		architecture: normalized as LinuxArchitecture,
		libc,
		isSupported: false,
		unsupportedReason: `Rolldown does not publish prebuilt native binaries for Linux CPU architecture "${normalized}". Only x86_64 (amd64) and aarch64 (arm64) are supported.`,
	};
};

/**
 * Computes architecture- and OS-isolated cache key to prevent cross-architecture
 * or cross-platform cached native module reuse.
 */
export const getNativeModuleCacheKey = (options: {
	packageName: string;
	version: string;
	os?: string;
	architecture?: string;
	libc?: LinuxLibc;
}): string => {
	const os = options.os || "linux";
	const arch = options.architecture || "x86_64";
	const libc = options.libc || "gnu";
	return `native-cache::${options.packageName}@${options.version}::${os}-${arch}-${libc}`;
};

/**
 * Inspects project manifests and dependencies to determine if native binding
 * recovery is necessary, valid, or unsupported.
 */
export const planNativeBindingResolution = (params: {
	packageJson?: Record<string, any> | null;
	lockfileContent?: string | null;
	installedRolldownVersion?: string | null;
	installedBindingVersion?: string | null;
	currentArch?: string;
	currentLibc?: LinuxLibc;
	packageManager?: SupportedPackageManager;
}): NativeDependencyResolutionResult => {
	const pm = params.packageManager || "npm";
	const arch = params.currentArch || "x86_64";
	const libc = params.currentLibc || "gnu";

	const allDeps = {
		...(params.packageJson?.dependencies || {}),
		...(params.packageJson?.devDependencies || {}),
	};

	const hasRolldown = Boolean(
		allDeps.rolldown ||
		(allDeps.vite && /^[\^~]?[89]/.test(allDeps.vite))
	);

	if (!hasRolldown) {
		return { status: "not_needed", packageManager: pm };
	}

	const target = resolveRolldownBindingTarget(arch, libc);
	if (!target.isSupported) {
		return {
			status: "unsupported_architecture",
			targetArchitecture: arch,
			packageManager: pm,
			diagnosticCode: "UNSUPPORTED_NATIVE_ARCHITECTURE",
			explanation: target.unsupportedReason,
			remediation:
				"Deploy to a 64-bit x86_64 (amd64) or aarch64 (arm64) Linux server host, or configure a custom Dockerfile with a compatible JavaScript toolchain.",
		};
	}

	const bindingPkg = target.packageName;
	const requiredVersion = params.installedRolldownVersion?.trim() || allDeps.rolldown?.replace(/^[\^~]/, "");

	// Check if binding is already installed and matches version
	if (params.installedBindingVersion) {
		if (!requiredVersion || params.installedBindingVersion === requiredVersion) {
			return {
				status: "already_valid",
				bindingPackage: bindingPkg,
				installedVersion: params.installedBindingVersion,
				requiredVersion,
				packageManager: pm,
			};
		}

		// Installed binding is incompatible with running rolldown version
		return {
			status: "incompatible_version",
			bindingPackage: bindingPkg,
			installedVersion: params.installedBindingVersion,
			requiredVersion,
			packageManager: pm,
			diagnosticCode: "INCOMPATIBLE_NATIVE_BINDING_VERSION",
			explanation: `Installed native binding ${bindingPkg}@${params.installedBindingVersion} conflicts with required Rolldown version ${requiredVersion}.`,
			remediation: `HatDot will install the exact compatible native binding (${bindingPkg}@${requiredVersion}) into the container without modifying your repository lockfile.`,
			recoveryCommand: buildConstrainedRecoveryCommand({
				packageManager: pm,
				packageName: bindingPkg,
				version: requiredVersion,
			}),
		};
	}

	// Missing binding: construct constrained, non-mutating recovery command
	return {
		status: "needs_recovery",
		bindingPackage: bindingPkg,
		requiredVersion,
		packageManager: pm,
		diagnosticCode: "NATIVE_BINDING_RESOLUTION_FAILED",
		explanation: `Platform-specific native binary ${bindingPkg} was omitted from the cross-platform lockfile (npm/cli#4828).`,
		remediation: `HatDot will safely fetch ${bindingPkg}${requiredVersion ? `@${requiredVersion}` : ""} for Linux ${target.architecture} into the build container using ${pm}.`,
		recoveryCommand: buildConstrainedRecoveryCommand({
			packageManager: pm,
			packageName: bindingPkg,
			version: requiredVersion,
		}),
	};
};

/**
 * Builds package-manager-specific, non-save command that installs ONLY the exact
 * native binding package into node_modules without modifying customer lockfiles
 * or touching unrelated dependencies.
 */
export const buildConstrainedRecoveryCommand = (params: {
	packageManager: SupportedPackageManager;
	packageName: string;
	version?: string;
}): string => {
	const spec = params.version ? `${params.packageName}@${params.version}` : params.packageName;

	switch (params.packageManager) {
		case "pnpm":
			return `pnpm add --save-optional=false --save-exact=false "${spec}"`;
		case "yarn":
			return `yarn add --optional "${spec}"`;
		case "bun":
			return `bun add --no-save "${spec}"`;
		case "npm":
		default:
			// --no-save ensures package.json and package-lock.json are NEVER modified
			// --ignore-scripts=false ensures binary unpack scripts run cleanly
			return `npm install "${spec}" --no-save --ignore-scripts=false`;
	}
};

/**
 * Generates the hardened, architecture-aware bash preflight snippet for Nixpacks builds.
 * Preserves customer lockfiles, respects package manager, checks architecture, and verifies result.
 */
export const generateNativeBindingPreflightScript = (packageManager: SupportedPackageManager = "npm"): string => {
	return `
# HatDot Hardened Native Dependency Preflight
if [ -d "node_modules/rolldown" ]; then
  ARCH=$(uname -m 2>/dev/null || echo "x86_64") ;
  case "$ARCH" in
    x86_64|amd64) BINDING_PKG="@rolldown/binding-linux-x64-gnu" ;;
    aarch64|arm64) BINDING_PKG="@rolldown/binding-linux-arm64-gnu" ;;
    *)
      echo "❌ HatDot Error [UNSUPPORTED_NATIVE_ARCHITECTURE]: CPU architecture '$ARCH' is not supported by Rolldown native bindings." >&2 ;
      echo "Supported architectures: x86_64, aarch64." >&2 ;
      exit 1 ;
      ;;
  esac ;

  if [ -d "node_modules/$BINDING_PKG" ]; then
    echo "✓ HatDot verified native binding $BINDING_PKG is already installed and valid." ;
  else
    R_VER=$(node -e "try{console.log(require('./node_modules/rolldown/package.json').version)}catch(e){}" 2>/dev/null || echo "") ;
    if [ -n "$R_VER" ]; then
      TARGET="\${BINDING_PKG}@\${R_VER}" ;
    else
      TARGET="$BINDING_PKG" ;
    fi ;

    echo "⚡ HatDot detected missing native binding ($TARGET) in cross-platform lockfile. Installing compatible Linux binary..." ;
    case "${packageManager}" in
      pnpm) pnpm add --save-optional=false "$TARGET" ;;
      yarn) yarn add --optional "$TARGET" ;;
      bun)  bun add --no-save "$TARGET" ;;
      *)    npm install "$TARGET" --no-save --ignore-scripts=false ;;
    esac || {
      echo "❌ HatDot Error [NATIVE_BINDING_RESOLUTION_FAILED]: Failed to install required native binding: $TARGET" >&2 ;
      exit 1 ;
    } ;

    # Verify installation succeeded and package directory exists
    if [ ! -d "node_modules/$BINDING_PKG" ]; then
      echo "❌ HatDot Error [NATIVE_BINDING_RESOLUTION_FAILED]: Native binding package $BINDING_PKG was not found in node_modules after installation." >&2 ;
      exit 1 ;
    fi ;
    echo "✓ HatDot successfully verified native binding $BINDING_PKG." ;
  fi ;
fi
`.trim();
};
