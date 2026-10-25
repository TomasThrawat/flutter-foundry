import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { analyzeBuildLog, auditAccessibility, auditAndroidFiles, checkLocalizations, summarizeLcov } from "@/lib/analysis";
import { getPubPackage, queryOsvPackages, searchPubPackages } from "@/lib/resources";
import { runSvgEdit } from "@/lib/svg-edit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const handler = createMcpHandler((server) => {
  const register = (name: string, title: string, description: string, inputSchema: z.ZodTypeAny, run: (input: any) => Promise<unknown> | unknown) => {
    server.registerTool(name, { title, description, inputSchema }, async (input: any) => {
      try {
        const result = await run(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Tool execution failed." }] };
      }
    });
  };

  register("flutter_resources_search", "Search Flutter packages", "Search the live pub.dev package index.", z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(20).optional() }).strict(),
    async ({ query, limit }: { query: string; limit?: number }) => ({ source: "pub.dev API", query, results: await searchPubPackages(query, limit || 10) }));

  register("flutter_resource_details", "Inspect a Flutter package", "Fetch current package metadata from the official pub.dev API.", z.object({ package: z.string().min(1).max(100) }).strict(),
    async ({ package: packageName }: { package: string }) => ({ source: "pub.dev API", package: await getPubPackage(packageName) }));

  register("flutter_code_reference", "Get official Flutter references", "Map a task to official Flutter/Dart documentation and upstream repositories.", z.object({
    task: z.enum(["new_feature", "repair_error", "dependency_change", "review_code", "test_failure", "release_build", "localization", "accessibility"])
  }).strict(), ({ task }: { task: string }) => {
    const common = [{ label: "Flutter docs", url: "https://docs.flutter.dev/" }, { label: "Flutter source", url: "https://github.com/flutter/flutter" }, { label: "Dart docs", url: "https://dart.dev/" }];
    const extra: Record<string, Array<{ label: string; url: string }>> = {
      new_feature: [{ label: "Cookbook", url: "https://docs.flutter.dev/cookbook" }, { label: "Widgets", url: "https://docs.flutter.dev/ui/widgets" }],
      repair_error: [{ label: "Common errors", url: "https://docs.flutter.dev/testing/common-errors" }, { label: "Flutter CLI", url: "https://docs.flutter.dev/reference/flutter-cli" }],
      dependency_change: [{ label: "pub.dev", url: "https://pub.dev/" }, { label: "Pubspec format", url: "https://dart.dev/tools/pub/pubspec" }],
      review_code: [{ label: "Effective Dart", url: "https://dart.dev/effective-dart" }, { label: "Architecture", url: "https://docs.flutter.dev/app-architecture" }],
      test_failure: [{ label: "Testing", url: "https://docs.flutter.dev/testing/overview" }],
      release_build: [{ label: "Android release", url: "https://docs.flutter.dev/deployment/android" }],
      localization: [{ label: "Internationalization", url: "https://docs.flutter.dev/ui/internationalization" }],
      accessibility: [{ label: "Accessibility", url: "https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility" }]
    };
    return { task, references: [...(extra[task] || []), ...common] };
  });

  register("flutter_architecture_guide", "Get Flutter architecture guidance", "Return a practical architecture outline; does not edit a repository.", z.object({
    style: z.enum(["minimal", "feature_first", "riverpod", "bloc", "modular"]),
    projectType: z.enum(["utility", "content", "realtime", "enterprise", "game"]).default("utility")
  }).strict(), ({ style, projectType }: { style: string; projectType: string }) => {
    const plans: Record<string, string[]> = {
      minimal: ["Avoid layers that only forward calls.", "Separate app shell, features, and tests.", "Add repositories when data sources or test isolation justify them."],
      feature_first: ["Group source by vertical feature.", "Keep each feature's public API narrow.", "Place cross-cutting config and shared UI under core."],
      riverpod: ["Use providers for dependencies and async state.", "Keep widgets focused on rendering and events.", "Test providers with overrides."],
      bloc: ["Use BLoC/Cubit at complex state boundaries.", "Keep networking and database code out of widgets.", "Test transitions and repositories independently."],
      modular: ["Use explicit feature module contracts.", "Keep routes and DI registrations feature-owned.", "Adopt modules when team boundaries justify the overhead."]
    };
    return { style, projectType, steps: plans[style], suggestedLayout: ["lib/app/", "lib/core/", "lib/features/<feature>/", "test/features/<feature>/"], caveat: "Architecture advice only; adapt to actual project and team constraints." };
  });

  register("flutter_recommend_developer_tooling", "Recommend Flutter developer tooling", "Recommend official/free tools for the selected workflow.", z.object({ projectType: z.enum(["app", "ui", "all"]).default("all") }).strict(),
    ({ projectType }: { projectType: string }) => ({ projectType, tools: [
      { name: "Flutter/Dart CLI", purpose: "format, analyze, test, build", url: "https://docs.flutter.dev/reference/flutter-cli" },
      { name: "DevTools", purpose: "inspect performance, memory and widget trees", url: "https://docs.flutter.dev/tools/devtools" },
      { name: "Flutter tests", purpose: "unit, widget and integration tests", url: "https://docs.flutter.dev/testing/overview" },
      { name: "GitHub Actions", purpose: "automate CI and release artifacts", url: "https://docs.github.com/en/actions" },
      { name: "OSV", purpose: "check known dependency vulnerabilities", url: "https://osv.dev/" },
      ...(projectType !== "app" ? [{ name: "Accessibility tests", purpose: "Flutter accessibility guideline checks", url: "https://docs.flutter.dev/ui/accessibility/accessibility-testing" }] : [])
    ], reminder: "Verify maintenance status, license, platform support and current package versions before adoption." }));

  register("flutter_stack_recommendation", "Recommend a Flutter stack", "Recommend a starter stack from app type and constraints.", z.object({
    appType: z.enum(["offline_utility", "content_app", "realtime_app", "large_team_app", "prototype", "game"]),
    constraints: z.string().max(2000).optional()
  }).strict(), ({ appType, constraints }: { appType: string; constraints?: string }) => {
    const stacks: Record<string, string[]> = {
      offline_utility: ["Flutter stable", "simple navigation unless go_router is warranted", "shared_preferences for small settings; SQLite/Drift for structured records", "flutter_test"],
      content_app: ["Flutter stable", "go_router if deep links are needed", "http or dio based on needs", "repository boundary and cached state", "integration_test for critical journeys"],
      realtime_app: ["Flutter stable", "repository/data-source separation", "WebSocket or backend SDK chosen for the service", "explicit reconnect/offline behavior", "ordering/reconnect integration tests"],
      large_team_app: ["Feature-first structure", "Riverpod or BLoC chosen consistently", "go_router", "strict lint and CI", "generated models only where useful"],
      prototype: ["Flutter stable", "minimal state management", "prefer built-in widgets first", "tests for the core user flow"],
      game: ["Flutter stable + Flame if a game loop/sprite system is needed", "separate game world from Flutter UI", "reproducible asset pipeline"]
    };
    return { appType, suggestedStack: stacks[appType], constraintsConsidered: constraints || "", caveat: "Verify package compatibility, maintenance and license on pub.dev." };
  });

  register("flutter_generate_ci_workflow", "Generate Flutter CI workflow", "Generate reusable GitHub Actions YAML for formatting, analysis, tests, coverage, and optional APK output. Returns text; does not commit files.", z.object({
    buildAndroid: z.boolean().default(true), flutterChannel: z.enum(["stable", "beta", "main"]).default("stable")
  }).strict(), ({ buildAndroid, flutterChannel }: { buildAndroid: boolean; flutterChannel: string }) => ({
    path: ".github/workflows/flutter-ci.yml",
    yaml: [
      "name: Flutter CI", "on:", "  push:", "    branches: [main]", "  pull_request:", "  workflow_dispatch:",
      "permissions:", "  contents: read", "concurrency:",
      "  group: flutter-ci-${{ github.workflow }}-${{ github.ref }}", "  cancel-in-progress: true", "jobs:", "  verify:",
      "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4", "      - uses: subosito/flutter-action@v2", "        with:",
      `          channel: ${flutterChannel}`, "          cache: true", "      - run: flutter --version", "      - run: flutter pub get",
      "      - run: dart format --output=none --set-exit-if-changed .", "      - run: flutter analyze --fatal-infos", "      - run: flutter test --coverage",
      ...(buildAndroid ? ["      - run: flutter build apk --release", "      - uses: actions/upload-artifact@v4", "        with:", "          name: flutter-release-apk", "          path: build/app/outputs/flutter-apk/*.apk", "          if-no-files-found: error"] : [])
    ].join("\\n") + "\\n",
    notes: ["Save the returned YAML to .github/workflows/flutter-ci.yml.", "Review action versions and repository security policy before production use."]
  }));

  register("flutter_analyze_build_log", "Analyze Flutter build log", "Triage common Dart, Pub, Gradle, SDK, memory, test and signing errors.", z.object({ log: z.string().min(1).max(100000) }).strict(),
    ({ log }: { log: string }) => analyzeBuildLog(log));

  register("flutter_plan_repairs", "Plan Flutter repairs", "Convert known build-log patterns into prioritized repair suggestions; does not execute commands.", z.object({ log: z.string().min(1).max(100000) }).strict(),
    ({ log }: { log: string }) => {
      const result = analyzeBuildLog(log);
      return { priorityOrder: result.findings.map((finding, index) => ({ priority: index + 1, category: finding.category, line: finding.line, evidence: finding.excerpt, action: finding.action })),
        suggestedCommands: ["flutter doctor -v", "flutter pub get", "flutter analyze", "flutter test"], unclassified: result.unclassified,
        limitations: "Run only the command relevant to the first concrete error; no commands are executed by this tool." };
    });

  register("flutter_check_localizations", "Check ARB localizations", "Compare ARB JSON files for missing keys, extra keys and named-placeholder mismatches.", z.object({
    baseArb: z.string().min(1).max(300000),
    localizedArbs: z.record(z.string(), z.string()).refine(value => Object.keys(value).length <= 30, "At most 30 locale files are supported.")
  }).strict(), ({ baseArb, localizedArbs }: { baseArb: string; localizedArbs: Record<string, string> }) => checkLocalizations(baseArb, localizedArbs));

  register("flutter_summarize_coverage", "Summarize LCOV coverage", "Parse lcov.info text and report line coverage per file and overall; does not run tests.", z.object({
    lcovInfo: z.string().min(1).max(500000), thresholdPercent: z.number().min(0).max(100).default(80)
  }).strict(), ({ lcovInfo, thresholdPercent }: { lcovInfo: string; thresholdPercent: number }) => summarizeLcov(lcovInfo, thresholdPercent));

  register("flutter_audit_android_security", "Audit Android project security", "Run heuristic checks on supplied AndroidManifest.xml and Gradle text.", z.object({
    manifestXml: z.string().min(1).max(300000), gradleText: z.string().max(300000).optional()
  }).strict(), ({ manifestXml, gradleText }: { manifestXml: string; gradleText?: string }) => ({
    findings: auditAndroidFiles(manifestXml, gradleText || ""), sourceFilesReceived: { manifest: true, gradle: Boolean(gradleText) },
    note: "Static heuristic review; inspect the complete merged release manifest to confirm." }));

  register("flutter_audit_accessibility", "Audit Flutter accessibility patterns", "Scan supplied Dart source for common accessibility risks; not a complete widget-tree analyzer.", z.object({
    files: z.array(z.object({ path: z.string().min(1).max(300), source: z.string().max(150000) })).min(1).max(40)
  }).strict(), ({ files }: { files: Array<{ path: string; source: string }> }) => auditAccessibility(files));

  register("flutter_scan_pub_dependencies", "Scan Pub dependencies with OSV", "Query official OSV for exact versions of supplied Dart/Flutter packages.", z.object({
    packages: z.array(z.object({ name: z.string().min(1).max(200), version: z.string().min(1).max(100) })).min(1).max(100)
  }).strict(), async ({ packages }: { packages: Array<{ name: string; version: string }> }) => ({ source: "OSV API", results: await queryOsvPackages(packages) }));

  register("flutter_scan_project_dependencies", "Scan project dependencies", "Query OSV for supplied exact package versions and selected ecosystems.", z.object({
    packages: z.array(z.object({ name: z.string().min(1).max(200), version: z.string().min(1).max(100), ecosystem: z.enum(["Pub", "npm", "PyPI", "Maven", "Go", "crates.io", "NuGet", "RubyGems"]).default("Pub") })).min(1).max(100)
  }).strict(), async ({ packages }: { packages: Array<{ name: string; version: string; ecosystem: string }> }) => ({
    source: "OSV API", results: await queryOsvPackages(packages), note: "Only caller-supplied exact versions are scanned; lockfiles are not resolved by this tool."
  }));

  register("flutter_review_project_context", "Review Flutter project context", "Give a cautious review from SDK versions, dependency metadata and target platforms; Pub remains authoritative.", z.object({
    flutterVersion: z.string().min(1).max(80), dartVersion: z.string().min(1).max(80),
    dependencies: z.array(z.object({ name: z.string().min(1).max(100), resolvedVersion: z.string().max(80).optional(), versionConstraint: z.string().max(120).optional() })).max(100).default([]),
    targetPlatforms: z.array(z.enum(["android", "ios", "web", "windows", "macos", "linux"])).max(6).default([])
  }).strict(), ({ flutterVersion, dartVersion, dependencies, targetPlatforms }: { flutterVersion: string; dartVersion: string; dependencies: Array<{ name: string; resolvedVersion?: string; versionConstraint?: string }>; targetPlatforms: string[] }) => ({
    flutterVersion, dartVersion, targetPlatforms, dependencyCount: dependencies.length,
    dependenciesMissingResolvedVersion: dependencies.filter(item => !item.resolvedVersion).map(item => item.name),
    review: ["Confirm SDK versions match CI and local development.", "Run flutter pub get and preserve pubspec.lock for apps.", "Run flutter pub outdated to assess updates.", "Verify plugin support for each target platform."],
    source: "Advisory only; actual SDK behavior and Pub's solver remain authoritative."
  }));

  register("flutter_review_release_artifact_report", "Review Android release artifact report", "Inspect text metadata copied from APK/AAB tools or build logs; does not read binary artifacts directly.", z.object({ report: z.string().min(1).max(300000) }).strict(),
    ({ report }: { report: string }) => {
      const patterns = [
        { label: "APK/AAB signature evidence", regex: /signed|signature|signing certificate/i, recommendation: "Verify the final artifact using apksigner or bundletool; log mentions alone do not prove authenticity." },
        { label: "ABI evidence", regex: /arm64-v8a|armeabi-v7a|x86_64|abi/i, recommendation: "Confirm packaged native libraries match intended devices." },
        { label: "Minimum SDK evidence", regex: /minSdkVersion|minimum sdk|min sdk/i, recommendation: "Verify minSdk and targetSdk using actual manifest and Gradle outputs." },
        { label: "Debug build risk", regex: /debuggable\\s*[:=]?\\s*true|debug build/i, recommendation: "Ensure release variant and merged manifest are correct." },
        { label: "Sensitive permissions", regex: /READ_SMS|READ_CONTACTS|READ_PHONE_STATE|ACCESS_FINE_LOCATION|MANAGE_EXTERNAL_STORAGE/i, recommendation: "Review necessity, consent and platform policy for each sensitive permission." },
        { label: "Build failure", regex: /BUILD FAILED|FAILURE: Build failed/i, recommendation: "Do not treat a partial artifact as a successful release." }
      ];
      return { findings: patterns.filter(item => item.regex.test(report)).map(item => ({ evidenceType: item.label, recommendation: item.recommendation })),
        reportLength: report.length, note: "Text-based triage. Use Android SDK tools on the actual artifact to verify signatures, SDK metadata, native libraries and permissions." };
    });

  register("svgedit_process_svg", "Edit and export SVG through SVG-Edit", "Playwright Chromium opens upstream SVG-Edit, imports SVG into its editor canvas, serializes the result and captures a PNG screenshot. No template icon generator or image API is used.", z.object({ svgMarkup: z.string().min(1).max(250000) }).strict(),
    async ({ svgMarkup }: { svgMarkup: string }) => {
      const result = await runSvgEdit(svgMarkup);
      return { svgMarkup: result.svg, previewPngBase64: result.previewPngBase64, editorUrl: result.editorUrl, elapsedMs: result.elapsedMs,
        note: "Imported and serialized by SVG-Edit through Playwright Chromium; screenshot is base64 PNG." };
    });

  register("svgedit_editor_info", "Get SVG-Edit editor info", "Return upstream SVG-Edit project and editor URLs and integration details.", z.object({}).strict(), () => ({
    project: "SVG-Edit", repository: "https://github.com/SVG-Edit/svgedit",
    hostedEditor: process.env.SVG_EDIT_URL || "https://svgedit.netlify.app/index.html",
    integration: "Playwright + Chromium; open editor, call loadSvgString, serialize canvas, capture screenshot.",
    license: "Verify upstream and dependency licenses before redistribution."
  }));
});

function authorize(request: Request): Response | null {
  const token = process.env.MCP_API_TOKEN;
  if (!token) return null;
  if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });
  return null;
}
export async function GET(request: Request) { return authorize(request) || handler(request); }
export async function POST(request: Request) { return authorize(request) || handler(request); }