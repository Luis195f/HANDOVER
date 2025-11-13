// BEGIN HANDOVER: SENTRY_INIT
import * as Sentry from "@sentry/react-native";
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  enableAutoPerformanceTracking: true
});
export { Sentry };
// END HANDOVER: SENTRY_INIT
