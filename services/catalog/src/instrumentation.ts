// Loaded before anything else by main.ts. dotenv first, so OTEL_* from a local .env reach the SDK;
// inside a container there is no .env and this is a no-op.
import 'dotenv/config';
import '@wayfare/nest-common/instrumentation';
