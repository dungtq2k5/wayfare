// Loaded before anything else by main.ts. dotenv first, so OTEL_* from a local .env reach the SDK;
// inside a container there is no .env and this is a no-op.
import 'dotenv/config';
import '@wayfare/nest-common/instrumentation';
import { installWarningLogger } from '@wayfare/nest-common/warnings';

// Every process warning goes through the service's structured logger (conventions §14.1).
installWarningLogger({ env: process.env });
