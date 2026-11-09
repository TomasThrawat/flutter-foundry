import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeBuildLog,
	auditAccessibility,
	auditAndroidFiles,
	checkLocalizations,
	summarizeLcov,
} from "../lib/analysis";

test("build log analyzer classifies SDK and dependency errors", () => {
	const r = analyzeBuildLog(
		"SDK location not found\nBecause demo depends on xyz version solving failed",
	);
	assert.equal(r.findings.length, 2);
	assert.equal(r.findings[0].category, "Android SDK");
	assert.equal(r.findings[1].category, "Package resolution");
});
test("LCOV totals use DA records", () => {
	const r = summarizeLcov(
		"SF:lib/a.dart\nDA:1,1\nDA:2,0\nend_of_record\nSF:lib/b.dart\nDA:1,1\n",
	);
	assert.equal(r.coveredLines, 2);
	assert.equal(r.executableLines, 3);
	assert.equal(r.lineCoveragePercent, (2 / 3) * 100);
	assert.deepEqual(r.belowThreshold, ["lib/a.dart"]);
});
test("ARB comparison reports missing keys and placeholders", () => {
	const base = JSON.stringify({
		"@@locale": "en",
		hello: "Hello {name}",
		done: "Done",
	});
	const r = checkLocalizations(base, {
		"app_ar.arb": JSON.stringify({
			"@@locale": "ar",
			hello: "ÙØ±Ø­Ø¨Ø§",
			extra: "x",
		}),
	});
	assert.deepEqual(r.reports[0].missing, ["done"]);
	assert.deepEqual(r.reports[0].extra, ["extra"]);
	assert.equal(r.reports[0].placeholderMismatches.length, 1);
});
test("Android audit flags cleartext and debug settings", () => {
	const r = auditAndroidFiles(
		'<application android:usesCleartextTraffic="true" android:debuggable="true" />',
	);
	assert.ok(r.some((x) => x.title === "Cleartext HTTP is allowed"));
	assert.ok(r.some((x) => x.title === "Debuggable build flag appears enabled"));
});
test("accessibility scan identifies possible missing labels", () => {
	const r = auditAccessibility([
		{
			path: "lib/home.dart",
			source:
				"IconButton(icon: const Icon(Icons.close), onPressed: close)\nImage.asset('assets/a.png')",
		},
	]);
	assert.ok(r.findings.some((x) => x.issue.includes("IconButton")));
	assert.ok(r.findings.some((x) => x.issue.includes("Image")));
});

test("build log analyzer identifies Flutter assets and reports its earliest root cause", () => {
	const r = analyzeBuildLog(
		"Unable to load asset: assets/icons/send.png\nDuplicate class com.example.Widget found in modules a.jar and b.jar",
	);
	assert.equal(r.findings[0].category, "Flutter asset");
	assert.equal(r.likelyRootCause?.category, "Flutter asset");
	assert.equal(r.likelyRootCause?.line, 1);
});

test("ARB reports locale direction and warns when the file name conflicts with @@locale", () => {
	const r = checkLocalizations(
		JSON.stringify({ "@@locale": "en", title: "Title" }),
		{
			"app_ar.arb": JSON.stringify({ "@@locale": "ar", title: "العنوان" }),
			"app_he.arb": JSON.stringify({ "@@locale": "en", title: "Title" }),
			"app.arb": JSON.stringify({ "@@locale": "ar", title: "العنوان" }),
		},
	);
	assert.equal(r.reports[0].direction, "rtl");
	assert.equal(r.reports[0].localeMismatch, false);
	assert.equal(r.reports[1].direction, "ltr");
	assert.equal(r.reports[1].localeMismatch, true);
	assert.equal(r.reports[1].complete, false);
	assert.equal(r.reports[2].localeMismatch, false);
});

test("Android audit distinguishes permission-gated exported components and flags sensitive permissions", () => {
	const r = auditAndroidFiles(
		'<manifest><uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/><application><activity android:name=".Open" android:exported="true"/><service android:name=".Guarded" android:exported="true" android:permission="com.example.ACCESS"/></application></manifest>',
	);
	assert.ok(
		r.some(
			(x) => x.title === "Exported component has no component-level permission",
		),
	);
	assert.ok(r.some((x) => x.title === "All-files access permission requested"));
});
