"use client";

import { useEffect } from "react";
import { installClientErrorReporter } from "@/lib/client-error-report";

const BUILD_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

/**
 * Browser error reporter, mounted once by the root layout. It renders nothing;
 * the cleanup returned by the installer removes both listeners on unmount.
 */
export function ClientErrorReporter() {
	useEffect(() => installClientErrorReporter({ buildVersion: BUILD_VERSION }), []);
	return null;
}
