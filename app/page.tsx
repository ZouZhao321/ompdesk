import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { ImagePreviewProvider } from "@/components/ImageZoom";
import { I18nProvider } from "@/hooks/useI18n";

export default function Home() {
	return (
		<Suspense>
			<I18nProvider>
				<ImagePreviewProvider>
					<AppShell />
				</ImagePreviewProvider>
			</I18nProvider>
		</Suspense>
	);
}
