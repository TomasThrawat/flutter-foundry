export type Finding = {
	severity: "critical" | "high" | "medium" | "low" | "info";
	title: string;
	evidence: string;
	recommendation: string;
};
export function analyzeBuildLog(log: string) {
	const patterns: Array<{
		category: string;
		regex: RegExp;
		cause: string;
		action: string;
	}> = [
		{
			category: "Dart compile error",
			regex:
				/Error: (?:The getter|The method|Undefined name|A value of type|Expected|Can't|The argument type|Not a constant expression)/i,
			cause: "Dart source failed static compilation.",
			action:
				"Fix the first Dart error at its source location before addressing follow-on errors.",
		},
		{
			category: "Package resolution",
			regex:
				/version solving failed|Because .* depends on .* version solving failed|pub get failed|could not resolve/i,
			cause: "Pub could not resolve a compatible dependency graph.",
			action:
				"Inspect the constraints in the first solver block and change the smallest set of incompatible constraints.",
		},
		{
			category: "Gradle dependency/network",
			regex:
				/Could not resolve all files|Could not GET|UnknownHostException|Connection timed out|PKIX path building failed/i,
			cause:
				"Gradle could not retrieve a dependency or trust its TLS connection.",
			action:
				"Check repository access, DNS, proxy and certificates before changing dependency versions.",
		},
		{
			category: "Android SDK",
			regex:
				/SDK location not found|failed to find target with hash string|platforms;android-|licenses not accepted/i,
			cause: "The Android SDK or a required platform/license is missing.",
			action:
				"Install the requested SDK platform/build-tools and accept licenses in the build environment.",
		},
		{
			category: "Kotlin/Gradle compatibility",
			regex:
				/Unsupported class file major version|requires .* Gradle|minimum supported Gradle version|Kotlin Gradle plugin/i,
			cause:
				"JDK, Gradle wrapper, Android Gradle Plugin, or Kotlin plugin versions may be incompatible.",
			action:
				"Compare the full version matrix in official Android Gradle Plugin compatibility guidance.",
		},
		{
			category: "Out of memory",
			regex:
				/Java heap space|OutOfMemoryError|GC overhead limit exceeded|Killed process .*java/i,
			cause: "The build process exhausted available memory.",
			action:
				"Reduce parallel builds and check runner memory/heap settings before changing application code.",
		},
		{
			category: "Flutter asset",
			regex: /Unable to load asset:|No file or variants found for asset|AssetNotFoundException/i,
			cause: "Flutter could not find an asset at the path referenced by the app or its pubspec.",
			action: "Check the exact path and filename casing, confirm the file is included under flutter.assets in pubspec.yaml, then run flutter pub get.",
		},
		{
			category: "Dart package/import",
			regex: /Target of URI doesn't exist|Couldn't resolve the package|Not found: ['"]package:/i,
			cause: "Dart could not resolve an imported package or source URI.",
			action: "Verify the package name and pubspec constraint, then resolve dependencies in the project environment before changing imports.",
		},
		{
			category: "Android manifest merge",
			regex: /Manifest merger failed|uses-sdk:minSdkVersion .* cannot be smaller than version .* declared in library|Attribute .* is also present at/i,
			cause: "The app manifest conflicts with a library manifest or an Android SDK requirement.",
			action: "Inspect the manifest-merger report and the library's documented requirements; prefer a narrowly scoped tools:replace or SDK adjustment only when justified.",
		},
		{
			category: "Duplicate Android classes",
			regex: /Duplicate class .* found in modules|Program type already present:/i,
			cause: "Two dependencies contribute the same JVM/Android class.",
			action: "Trace both dependency paths with Gradle dependencyInsight and align or exclude the duplicate transitive dependency.",
		},
		{
			category: "Kotlin compiler",
			regex: /^e: file:.*\.kt:|Unresolved reference:|Kotlin compilation error/i,
			cause: "Kotlin source or a Kotlin plugin/API compatibility check failed.",
			action: "Fix the first Kotlin compiler diagnostic and verify Kotlin, AGP and Gradle compatibility before upgrading multiple versions.",
		},
		{
			category: "JVM target compatibility",
			regex: /Inconsistent JVM-target compatibility|jvmTarget.*does not match|compile.*Kotlin.*target compatibility/i,
			cause: "Kotlin and Java compilation target different JVM versions.",
			action: "Align Java sourceCompatibility/targetCompatibility and Kotlin jvmTarget for the affected Android module.",
		},
		{
			category: "Flutter plugin SDK requirement",
			regex: /plugin .* requires a higher Android SDK version|requires Android SDK version/i,
			cause: "A Flutter plugin requires a newer Android compile or minimum SDK than the project currently declares.",
			action: "Read the plugin's Android requirements and update compileSdk/minSdk only to the documented minimum needed.",
		},
		{
			category: "Test failure",
			regex:
				/Some tests failed|Expected: .*Actual:|TestFailure|Exception caught by test/i,
			cause: "At least one test assertion or test setup failed.",
			action:
				"Run the named test in isolation and fix the earliest failing assertion or test setup issue.",
		},
		{
			category: "Signing/release configuration",
			regex:
				/Keystore file not found|Execution failed for task .*sign|SigningConfig .* is missing|required a signing config/i,
			cause:
				"Release signing configuration is incomplete or points to a missing file.",
			action:
				"Check signing configuration and secret/file availability without committing keystores or passwords.",
		},
	];
	const lines = log.split(/\r?\n/);
	const findings: Array<{
		category: string;
		line: number;
		excerpt: string;
		cause: string;
		action: string;
	}> = [];
	const seen = new Set<string>();
	lines.forEach((line, index) => {
		for (const item of patterns) {
			if (item.regex.test(line)) {
				const key = `${item.category}:${line.trim()}`;
				if (!seen.has(key)) {
					findings.push({
						category: item.category,
						line: index + 1,
						excerpt: line.trim().slice(0, 500),
						cause: item.cause,
						action: item.action,
					});
					seen.add(key);
				}
				break;
			}
		}
	});
	return {
		linesAnalyzed: lines.length,
		findings: findings.slice(0, 60),
		unclassified: findings.length === 0,
		likelyRootCause: findings[0] || null,
		note: "Pattern-based triage only; the complete log and actual project remain authoritative.",
	};
}
export function summarizeLcov(lcov: string, thresholdPercent = 80) {
	if (
		!Number.isFinite(thresholdPercent) ||
		thresholdPercent < 0 ||
		thresholdPercent > 100
	)
		throw new Error("thresholdPercent must be between 0 and 100.");
	const files: Array<{
		file: string;
		covered: number;
		total: number;
		coveragePercent: number;
	}> = [];
	let current: { file: string; covered: number; total: number } | null = null;
	for (const line of lcov.split(/\r?\n/)) {
		if (line.startsWith("SF:")) {
			if (current)
				files.push({
					...current,
					coveragePercent: current.total
						? (current.covered / current.total) * 100
						: 0,
				});
			current = { file: line.slice(3).trim(), covered: 0, total: 0 };
		} else if (current && line.startsWith("DA:")) {
			const hit = Number(line.slice(3).split(",")[1]);
			if (Number.isFinite(hit)) {
				current.total++;
				if (hit > 0) current.covered++;
			}
		}
	}
	if (current)
		files.push({
			...current,
			coveragePercent: current.total
				? (current.covered / current.total) * 100
				: 0,
		});
	const coveredLines = files.reduce((sum, file) => sum + file.covered, 0);
	const executableLines = files.reduce((sum, file) => sum + file.total, 0);
	return {
		lineCoveragePercent: executableLines
			? (coveredLines / executableLines) * 100
			: 0,
		coveredLines,
		executableLines,
		files: files.sort((a, b) => a.coveragePercent - b.coveragePercent),
		belowThreshold: files
			.filter(
				(file) => file.total > 0 && file.coveragePercent < thresholdPercent,
			)
			.map((file) => file.file),
	};
}
function parseArb(text: string, label: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(text);
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new Error(`${label} must be a valid ARB JSON object.`);
	}
}
function isRtlLocale(locale: string): boolean {
	return /^(?:ar|fa|he|ur|ps|sd|ug|yi)(?:[-_]|$)/i.test(locale.trim());
}
function placeholders(value: unknown): string[] {
	if (typeof value !== "string") return [];
	return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
		.map((match) => match[1])
		.sort();
}
export function checkLocalizations(
	baseText: string,
	localized: Record<string, string>,
) {
	const base = parseArb(baseText, "base ARB");
	const baseKeys = Object.keys(base).filter(
		(key) => !key.startsWith("@") && key !== "@@locale",
	);
	const reports = Object.entries(localized).map(([locale, text]) => {
		const target = parseArb(text, `ARB for ${locale}`);
		const keys = Object.keys(target).filter(
			(key) => !key.startsWith("@") && key !== "@@locale",
		);
		const missing = baseKeys.filter((key) => !(key in target));
		const extra = keys.filter((key) => !(key in base));
		const fileName = locale.replace(/\.arb$/i, "").split(/[\\/]/).pop() || "";
		const fileLocale =
			fileName.match(/[_-]([a-z]{2,3}(?:[_-][A-Za-z0-9]+)*)$/i)?.[1] ||
			(/^[a-z]{2}(?:[_-][A-Za-z0-9]+)*$/i.test(fileName) ? fileName : "");
		const declaredLocale =
			typeof target["@@locale"] === "string" ? target["@@locale"] : fileLocale;
		const fileLanguage = fileLocale.match(/^[a-z]{2,3}/i)?.[0]?.toLowerCase();
		const declaredLanguage = declaredLocale.match(/^[a-z]{2,3}/i)?.[0]?.toLowerCase();
		const localeMismatch = Boolean(
			fileLanguage && declaredLanguage && fileLanguage !== declaredLanguage,
		);
		const placeholderMismatches = baseKeys
			.filter(
				(key) =>
					key in target &&
					JSON.stringify(placeholders(base[key])) !==
						JSON.stringify(placeholders(target[key])),
			)
			.map((key) => ({
				key,
				expected: placeholders(base[key]),
				actual: placeholders(target[key]),
			}));
		return {
			locale,
			baseKeyCount: baseKeys.length,
			translatedKeyCount: keys.length,
			missing,
			extra,
			placeholderMismatches,
			declaredLocale,
			direction: isRtlLocale(declaredLocale) ? "rtl" : "ltr",
			localeMismatch,
			complete: missing.length === 0 && placeholderMismatches.length === 0 && !localeMismatch,
		};
	});
	return { baseKeyCount: baseKeys.length, reports };
}
export function auditAndroidFiles(manifest: string, gradle = ""): Finding[] {
	const findings: Finding[] = [];
	const add = (
		severity: Finding["severity"],
		title: string,
		evidence: string,
		recommendation: string,
	) => findings.push({ severity, title, evidence, recommendation });
	if (/android:usesCleartextTraffic\s*=\s*"true"/i.test(manifest))
		add(
			"high",
			"Cleartext HTTP is allowed",
			'android:usesCleartextTraffic="true"',
			"Prefer HTTPS. If needed, scope exceptions to explicit domains using Network Security Configuration.",
		);
	if (
		/android:debuggable\s*=\s*"true"/i.test(manifest) ||
		/debuggable\s+true/i.test(gradle)
	)
		add(
			"high",
			"Debuggable build flag appears enabled",
			"A debuggable=true setting was found.",
			"Ensure release variants are not debuggable and verify the merged release manifest.",
		);
	if (/android:allowBackup\s*=\s*"true"/i.test(manifest))
		add(
			"medium",
			"Application backup is enabled",
			'android:allowBackup="true"',
			"Review data backup rules and whether app data can be exported.",
		);
	const exportedComponents = [
		...manifest.matchAll(/<(activity|activity-alias|service|receiver|provider)\b[^>]*>/gi),
	].filter((match) => /android:exported\s*=\s*"true"/i.test(match[0]));
	const unprotectedExports = exportedComponents.filter(
		(match) => !/android:permission\s*=/i.test(match[0]),
	);
	if (unprotectedExports.length)
		add(
			"medium",
			"Exported component has no component-level permission",
			unprotectedExports.map((match) => match[1]).join(", "),
			"Review each exported component's intent filters and caller requirements; add a permission only when the component should be restricted.",
		);
	for (const permission of [
		{ name: "MANAGE_EXTERNAL_STORAGE", title: "All-files access permission requested", severity: "high" as const, recommendation: "Prefer the Storage Access Framework or MediaStore unless broad file access is essential and eligible for Google Play policy exceptions." },
		{ name: "REQUEST_INSTALL_PACKAGES", title: "Package installation permission requested", severity: "high" as const, recommendation: "Confirm that user-initiated package installation is a core feature and that distribution policy permits it." },
		{ name: "SYSTEM_ALERT_WINDOW", title: "Overlay permission requested", severity: "medium" as const, recommendation: "Verify that drawing over other apps is essential and explain the special access clearly to users." },
		{ name: "QUERY_ALL_PACKAGES", title: "Broad package visibility requested", severity: "medium" as const, recommendation: "Use targeted package visibility queries when possible; broad visibility is restricted by platform and store policy." },
	]) {
		const hasPermission = [...manifest.matchAll(/<uses-permission\b[^>]*>/gi)].some(
			(tag) =>
				tag[0].match(/\bandroid:name\s*=\s*["']([^"']+)["']/i)?.[1] ===
					"android.permission." + permission.name,
		);
		if (hasPermission)
			add(permission.severity, permission.title, permission.name, permission.recommendation);
	}
	if (/uses-permission[^>]+WRITE_EXTERNAL_STORAGE/i.test(manifest))
		add(
			"medium",
			"Legacy external-storage write permission",
			"WRITE_EXTERNAL_STORAGE appears in manifest.",
			"Check whether scoped storage or the Storage Access Framework removes the need.",
		);
	if (/uses-permission[^>]+READ_PHONE_STATE/i.test(manifest))
		add(
			"medium",
			"Phone-state permission requested",
			"READ_PHONE_STATE appears in manifest.",
			"Confirm the permission is essential to user-facing functionality.",
		);
	if (!/android:usesCleartextTraffic|networkSecurityConfig/i.test(manifest))
		add(
			"info",
			"Network policy not explicit",
			"No explicit network security setting was found in supplied snippet.",
			"Inspect the complete merged manifest and decide whether a network-security config is needed.",
		);
	return findings;
}
export function auditAccessibility(
	files: Array<{ path: string; source: string }>,
) {
	const findings: Array<{
		file: string;
		line: number;
		issue: string;
		evidence: string;
		recommendation: string;
	}> = [];
	for (const file of files) {
		file.source.split(/\r?\n/).forEach((line, index) => {
			if (/\bIconButton\s*\(/.test(line) && !/tooltip:|Tooltip\s*\(/.test(line))
				findings.push({
					file: file.path,
					line: index + 1,
					issue: "IconButton may lack a tooltip/accessible label",
					evidence: line.trim().slice(0, 240),
					recommendation:
						"Provide a Tooltip and meaningful semantic label; verify the final widget tree.",
				});
			if (/\bGestureDetector\s*\(/.test(line) && !/\bSemantics\s*\(/.test(line))
				findings.push({
					file: file.path,
					line: index + 1,
					issue: "GestureDetector may miss semantic affordances",
					evidence: line.trim().slice(0, 240),
					recommendation:
						"Check keyboard activation, focus behavior, and Semantics/InkWell usage.",
				});
			if (
				/Image\.asset\(|Image\.network\(/.test(line) &&
				!/semanticLabel:/.test(line)
			)
				findings.push({
					file: file.path,
					line: index + 1,
					issue: "Image may lack a semantic label",
					evidence: line.trim().slice(0, 240),
					recommendation:
						"Add semanticLabel for meaningful images or exclude decorative imagery from semantics.",
				});
			if (/Color\(0x[0-9A-Fa-f]{8}\)/.test(line))
				findings.push({
					file: file.path,
					line: index + 1,
					issue: "Hard-coded color: contrast has not been verified",
					evidence: line.trim().slice(0, 240),
					recommendation:
						"Measure foreground/background contrast; this pattern alone does not prove a failure.",
				});
		});
	}
	return {
		filesScanned: files.length,
		findings,
		note: "Heuristic source scan only. Confirm with Flutter accessibility tests and manual screen-reader/keyboard checks.",
	};
}
